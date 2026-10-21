const { Api, TelegramClient } = require('teleproto');
const { Bot } = require('grammy');
const { StoreSession } = require('teleproto/sessions');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output, exit } = require('node:process');
const stringify = require('json-stringify-safe');
const { Command, Option, InvalidOptionArgumentError } = require('commander');
const { securedLogger: log } = require('./modules/logging/logging');
const { name: scriptName, version: scriptVersion } = require('./version');
const i18n = require('./modules/i18n/i18n.config');
const { Settings, parseAdminIds, BOT_TOKEN_MIN_LENGTH } = require('./modules/config/settings');
const { createManagementBot } = require('./modules/management/management');
const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const { toZonedTime, format: formatTz } = require('date-fns-tz');
const template = require('string-template');
const { google } = require('googleapis');
const crypto = require('node:crypto');

const timeZone = 'Europe/Kiev'; // Replace with your desired time zone

const program = new Command();

function parseInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 120) {
    throw new InvalidOptionArgumentError('Interval must be a number between 1 and 120 minutes.');
  }
  return parsed;
}

program
  .name(scriptName)
  .version(scriptVersion, '-v, --version', 'Show version number and exit')
  .option('--as-user', 'Start as user instance (bot instance by default)')
  .addOption(
    new Option('-i, --schedule-update-interval <minutes>', 'Update interval for schedule in minutes').default(5).argParser(parseInterval),
  )
  .option('-l, --language <code>', 'Language code for i18n', 'uk')
  .option('-d, --debug', 'Enable debug level logging')
  .option('--pin-message', 'Pin update messages in Telegram')
  .option('--unpin-previous', 'Unpin previous messages after pinning a new one')
  .option('--ignore-status', 'Process schedules even if status is not ScheduleApplies')
  .option('--admin-ids <ids>', 'Comma separated Telegram user ids allowed to manage the monitor via the bot')
  .option('--data-dir <path>', 'Directory for configuration, state and credentials', 'data')
  .addOption(new Option('--max-group-number <number>', 'Deprecated: group ids are taken from the Yasno API').hideHelp());

program.parse(process.argv);

const parsedOptions = program.opts();

const dataDir = parsedOptions.dataDir;
const configFilePath = path.join(dataDir, 'config.json');
const legacyStorageDir = path.join(dataDir, 'storage');
const keyFilePath = path.join(dataDir, 'yasno-monitor.json'); // path to JSON with private key been downloaded from Google
const sessionDir = path.join(dataDir, 'session');

log.setTimeZone(timeZone);
if (parsedOptions.debug) {
  log.setLevel('debug');
}
if (parsedOptions.maxGroupNumber !== undefined) {
  log.warn('Option --max-group-number is deprecated and ignored: group ids are taken from the Yasno API.');
}

const settings = new Settings({ filePath: configFilePath, logger: log });
settings.init({ legacyDir: legacyStorageDir });
settings.seedFromEnv(process.env);

/**
 * Effective option value: a CLI flag given explicitly wins, otherwise a value stored via the
 * management interface, otherwise the CLI default.
 */
function resolveOption(name, cliValue) {
  const source = program.getOptionValueSource(name);
  if (source === 'cli' || source === 'env') {
    return cliValue;
  }
  const stored = settings.getOption(name);
  return stored === null ? cliValue : stored;
}

const options = {
  asUser: Boolean(parsedOptions.asUser),
  scheduleUpdateInterval: resolveOption('scheduleUpdateInterval', parsedOptions.scheduleUpdateInterval),
  language: parsedOptions.language,
  debug: Boolean(resolveOption('debug', Boolean(parsedOptions.debug))),
  pinMessage: Boolean(resolveOption('pinMessage', Boolean(parsedOptions.pinMessage))),
  unpinPrevious: Boolean(resolveOption('unpinPrevious', Boolean(parsedOptions.unpinPrevious))),
  ignoreStatus: Boolean(resolveOption('ignoreStatus', Boolean(parsedOptions.ignoreStatus))),
};

if (typeof parsedOptions.adminIds === 'string' && parsedOptions.adminIds.length > 0) {
  const cliAdminIds = parseAdminIds(parsedOptions.adminIds);
  if (cliAdminIds.length > 0 && JSON.stringify(cliAdminIds) !== JSON.stringify(settings.getAdminIds())) {
    settings.setAdminIds(cliAdminIds);
  }
}

log.setLevel(options.debug ? 'debug' : 'info');

i18n.setLocale(options.language);

log.info(`Starting ${scriptName} v${scriptVersion} ...`);
log.info(`As user: ${options.asUser}`);
log.info(`Language: ${options.language}`);
log.info(`Schedule update interval: ${options.scheduleUpdateInterval} minutes`);
log.info(`Debug: ${options.debug}`);
log.info(`Configuration file: ${configFilePath}`);

/** Ids of the groups that are actively monitored (those with a calendar configured). */
const groups = [];

function refreshGroups() {
  const configured = settings.configuredGroupIds();
  groups.length = 0;
  groups.push(...configured);
  log.appendMaskWord(...groups.map((group) => `calendarIdGroup${group}`));
  log.info(`Active groups: ${groups.length > 0 ? groups.join(', ') : 'none'}`);
  return groups;
}

refreshGroups();

const yasnoApiUrl = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages';
const yasnoMainUrl = 'https://static.yasno.ua/kyiv/outages';
const svitlobotApiUrl = 'https://api.svitlobot.in.ua/';

const calendarScope = 'https://www.googleapis.com/auth/calendar'; // authorization scopes
const calendarEventsScope = 'https://www.googleapis.com/auth/calendar.events';

const calendarEventSummary = i18n.__('Power outage. Group {group}');
const calendarEventDescription = i18n.__('Planned power outage by information from {url}, on {timestamp}');

const textScheduleUpdated = i18n.__('Schedule for {today} ({date}) has been updated');
const textToday = i18n.__('today');
const textTomorrow = i18n.__('tomorrow');
const textScheduleOutageDefiniteLine = i18n.__('- off: {start} - {end}');
const textScheduleUpdatedAt = i18n.__('Data updated at {timestamp}');
const textScheduleNoOutages = i18n.__('no outages!');
const textScheduleEmergencyUnavailable = i18n.__('emergency outages! Schedule is not available!');
const statusesWithScheduleApplied = ['scheduleapplies', 'emergencyshutdowns'];

let telegramClient = null;
let telegramBot = null;
let managementBot = null;
let management = null;
const telegramTargetEntities = {};
const telegramTargetTitles = {};

let cachedPrivateKey = null;
let cachedCalendarAuth = null;
let cachedCalendarService = null;
const calendarEventsCache = new Map();
let lastYasnoChecksum = null;

const telegramParseMode = 'html';

/** Runtime state exposed to the management interface. */
const runtime = {
  startedAt: Date.now(),
  lastCheckAt: null,
  lastChangeAt: null,
  lastError: null,
  nextCheckAt: null,
  checkInProgress: false,
  lastSchedule: null,
};

let checkTimer = null;

function scheduleChecks() {
  if (checkTimer !== null) {
    clearInterval(checkTimer);
  }
  const intervalMs = options.scheduleUpdateInterval * 60 * 1000;
  checkTimer = setInterval(() => {
    checkForUpdates().catch((error) => log.error(`Scheduled check failed: ${error?.stack || error}`));
    runtime.nextCheckAt = Date.now() + intervalMs;
  }, intervalMs);
  runtime.nextCheckAt = Date.now() + intervalMs;
}

/**
 * Fetch the Yasno payload and process schedule changes.
 * @param {object} [params]
 * @param {boolean} [params.force] - Process even when the payload checksum is unchanged.
 * @returns {Promise<{changed: boolean, skipped: boolean, error: string|null}>}
 */
async function checkForUpdates({ force = false } = {}) {
  if (runtime.checkInProgress) {
    log.debug('Check already in progress, skipping.');
    return { changed: false, skipped: true, error: null };
  }
  runtime.checkInProgress = true;
  runtime.lastCheckAt = Date.now();
  let currentData;
  let payloadChecksum = null;
  const todayStr = formatDateInZone();
  log.debug(`Checking for updates, today is ${todayStr} ...`);
  try {
    try {
      const response = await axios.get(yasnoApiUrl);
      payloadChecksum = calculateChecksum(response.data);
      if (!force && payloadChecksum && payloadChecksum === lastYasnoChecksum) {
        log.debug('Yasno payload unchanged (checksum match), skipping processing.');
        return { changed: false, skipped: false, error: null };
      }
      if (response.data && typeof response.data === 'object' && settings.setYasnoGroupIds(Object.keys(response.data))) {
        log.info(`Yasno group list updated: ${settings.getYasnoGroupIds().length} groups (${settings.getYasnoGroupIds().join(', ')})`);
      }
      currentData = transformPlannedOutages(response.data, todayStr);
      if (!currentData) {
        throw new Error('Unable to process planned outage payload.');
      }
      runtime.lastSchedule = buildScheduleSnapshot(currentData, todayStr);
    } catch (error) {
      log.error('Error fetching planned outage data:', error);
      runtime.lastError = String(error?.message || error);
      return { changed: false, skipped: false, error: runtime.lastError };
    }

    if (!currentData || !currentData.intervals) {
      log.error('No valid intervals found in processed data.');
      runtime.lastError = 'No valid intervals found in processed data.';
      return { changed: false, skipped: false, error: runtime.lastError };
    }

    try {
      const changed = await processScheduleUpdate(currentData, todayStr);
      if (payloadChecksum) {
        lastYasnoChecksum = payloadChecksum;
      }
      if (changed) {
        runtime.lastChangeAt = Date.now();
      }
      runtime.lastError = null;
      return { changed, skipped: false, error: null };
    } catch (error) {
      log.error('Failed to process planned outage update:', error?.stack || error);
      runtime.lastError = String(error?.message || error);
      return { changed: false, skipped: false, error: runtime.lastError };
    }
  } finally {
    runtime.checkInProgress = false;
  }
}

function buildScheduleSnapshot(currentData, todayStr) {
  const snapshot = {
    fetchedAt: Date.now(),
    todayStr,
    tomorrowStr: formatDateInZone(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    groups: {},
  };
  for (const group of Object.keys(currentData.intervals)) {
    const days = {};
    for (const dayStr of Object.keys(currentData.intervals[group])) {
      days[dayStr] = {
        status: currentData.statuses?.[group]?.[dayStr] ?? null,
        intervals: currentData.intervals[group][dayStr],
      };
    }
    snapshot.groups[group] = {
      updatedOn: currentData.groupUpdates[group] ? new Date(currentData.groupUpdates[group]).toISOString() : null,
      days,
    };
  }
  return snapshot;
}

function transformPlannedOutages(payload, todayStr) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const intervals = {};
  const groupUpdates = {};
  const statuses = {};
  const relevantGroups = groups.length > 0 ? groups : Object.keys(payload);
  const knownYasnoStatuses = settings.getKnownYasnoStatuses();

  for (const group of relevantGroups) {
    const groupData = payload[group];
    if (!groupData) {
      log.warn(`No planned outage data returned for group ${group}`);
      intervals[group] = { [todayStr]: [] };
      groupUpdates[group] = new Date();
      statuses[group] = {};
      continue;
    } else {
      intervals[group] = {};
      statuses[group] = {};
    }

    const groupUpdatedOn = new Date(groupData.updatedOn);
    if (Number.isNaN(groupUpdatedOn.getTime())) {
      log.warn(`No information about updatedOn for group ${group}`);
      continue;
    }
    groupUpdates[group] = groupUpdatedOn;
    log.debug(`Group ${group} updated on ${formatUpdatedOn(groupUpdatedOn)}`);

    log.debug(`Processing planned outages for group ${group} on keys: ${Object.keys(groupData).join(', ')} ...`);

    for (const dayKey of Object.keys(groupData)) {
      const dayData = groupData[dayKey];
      if (!dayData || !Array.isArray(dayData.slots)) {
        continue;
      }

      log.debug(`Processing day data for group ${group} on ${dayKey}: ${stringify(dayData)}`);

      const dayValue = new Date(dayData.date);
      if (Number.isNaN(dayValue.getTime())) {
        log.warn(`Invalid date value for group ${group} on ${dayKey}: ${dayData.date}`);
        continue;
      }

      const dayDateStr = dayData.date.split('T')[0];
      if (!dayDateStr || dayDateStr.length === 0) {
        log.warn(`Unable to format date string for group ${group} on ${dayKey}: ${dayData.date}`);
        continue;
      }
      if (Object.hasOwn(intervals[group], dayDateStr)) {
        log.debug(`Intervals for group ${group} on ${dayDateStr} already processed, skipping duplicate.`);
        continue;
      }
      intervals[group][dayDateStr] = [];
      log.debug(`Processing group ${group} for day ${dayKey} with date string ${dayDateStr} ...`);

      if (!Object.hasOwn(knownYasnoStatuses, dayData.status)) {
        knownYasnoStatuses[dayData.status] = dayData;
        log.info(`New Yasno status encountered: ${dayData.status} for group ${group} on ${dayKey}. Added to known statuses.`);
        settings.addKnownYasnoStatus(dayData.status, dayData);
      }
      const currentStatus = String(dayData.status || '').toLowerCase();
      statuses[group][dayDateStr] = currentStatus;
      if (!statusesWithScheduleApplied.includes(currentStatus) && !options.ignoreStatus) {
        log.debug(`Schedule does not apply for group ${group} on ${dayKey} (${dayData.date}).`);
        continue;
      }
      log.debug(`Schedule applies for group ${group} on ${dayKey} (${dayData.date}).`);

      if (parseInt(dayDateStr.replace(/-/g, ''), 10) < parseInt(todayStr.replace(/-/g, ''), 10)) {
        log.debug(`Day ${dayDateStr} is in the past for group ${group} on ${dayKey}.`);
        continue;
      }
      intervals[group][dayDateStr] = buildIntervalsFromSlots(dayData.slots);
      log.debug(`Intervals for group ${group} on ${dayDateStr}: ${stringify(intervals[group][dayDateStr])}`);
    }
  }

  return {
    intervals,
    groupUpdates,
    statuses,
  };
}

function formatDateInZone(date = new Date(), zone = timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: zone,
  });
  return formatter.format(date); // "YYYY-MM-DD"
}

function buildIntervalsFromSlots(slots) {
  if (!Array.isArray(slots)) {
    return [];
  }

  const definiteSlots = slots
    .filter((slot) => slot && typeof slot.start === 'number' && typeof slot.end === 'number' && String(slot.type).toLowerCase() === 'definite')
    .sort((slotA, slotB) => slotA.start - slotB.start);

  const mergedIntervals = [];

  for (const slot of definiteSlots) {
    const startMinutes = slot.start;
    const endMinutes = slot.end;

    if (endMinutes <= startMinutes) {
      continue;
    }

    if (mergedIntervals.length === 0) {
      mergedIntervals.push({ startMinutes, endMinutes });
      continue;
    }

    const lastInterval = mergedIntervals[mergedIntervals.length - 1];
    if (lastInterval.endMinutes === startMinutes) {
      lastInterval.endMinutes = endMinutes;
    } else {
      mergedIntervals.push({ startMinutes, endMinutes });
    }
  }

  return mergedIntervals;
}

function parseDateStringAsLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDateWithTimezone(date) {
  return formatTz(date, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone });
}

function setTimeForDate(baseDate, hours, minutes, seconds = 0, milliseconds = 0) {
  const zonedDate = toZonedTime(baseDate, timeZone);
  const result = new Date(zonedDate.getTime());
  result.setHours(hours, minutes, seconds, milliseconds);
  return result;
}

function formatDateTimeForMinutes(baseDate, totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return formatDateWithTimezone(setTimeForDate(baseDate, hours, minutes, 0, 0));
}

function formatStartOfDay(baseDate) {
  return formatDateWithTimezone(setTimeForDate(baseDate, 0, 0, 0, 0));
}

function formatEndOfDay(baseDate) {
  return formatDateWithTimezone(setTimeForDate(baseDate, 23, 59, 59, 999));
}

function formatUpdatedOn(timestamp) {
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function calculateChecksum(payload) {
  try {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  } catch (error) {
    log.error('Unable to calculate Yasno payload checksum:', error);
    return null;
  }
}

// -------- External timetable helpers (weekly, day-of-week based) --------

function dayOfWeekIndexFromDateStr(dateStr) {
  // JS getDay(): 0=Sunday..6=Saturday; map to Monday=0..Sunday=6
  const date = parseDateStringAsLocal(dateStr);
  const jsDay = date.getDay();
  return (jsDay + 6) % 7;
}

function buildEmptyWeeklyArray() {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}

function serializeWeeklyArray(weekly) {
  // Same format used by timetable editor: concatenate 24 digits per day and end day with ';'
  return (
    weekly
      .map((row) =>
        row
          .map((v) => {
            const n = parseInt(v);
            if (!Number.isFinite(n) || n < 0) return 0;
            if (n > 3) return 3;
            return n;
          })
          .join(''),
      )
      .join(';') + ';'
  );
}

function halfHourState(first, second) {
  if (first && second) {
    return 1;
  }
  if (first) {
    return 2;
  }
  return second ? 3 : 0;
}

function intervalsToDayStates(intervals) {
  // intervals: [{ startMinutes, endMinutes }]
  const states = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const firstStart = h * 60;
    const firstEnd = h * 60 + 30;
    const secondStart = h * 60 + 30;
    const secondEnd = (h + 1) * 60;

    let first = false;
    let second = false;

    for (const interval of intervals || []) {
      const s = interval.startMinutes;
      const e = interval.endMinutes;
      if (!(Number.isFinite(s) && Number.isFinite(e)) || e <= s) continue;
      // overlap if start < endOfHalf and end > startOfHalf
      if (s < firstEnd && e > firstStart) first = true;
      if (s < secondEnd && e > secondStart) second = true;
      if (first && second) break;
    }

    states[h] = halfHourState(first, second);
  }
  return states;
}

async function fetchExternalTimetableWeekly(svitlobotChannelId) {
  const url = `${svitlobotApiUrl}website/getChannelTimetable?channel_key=${encodeURIComponent(svitlobotChannelId)}`;
  const response = await axios.get(url);
  const data = String(response.data || '');
  if (!data.includes(';&&&;')) {
    // Unexpected format, return empty weekly
    return buildEmptyWeeklyArray();
  }
  const parts = data.split(';&&&;');
  const arrData = parts[1]?.trim();
  if (!arrData || arrData === 'no data') {
    return buildEmptyWeeklyArray();
  }
  try {
    const parsed = JSON.parse(arrData);
    // Validate structure
    if (Array.isArray(parsed) && parsed.length === 7 && parsed.every((row) => Array.isArray(row) && row.length === 24)) {
      return parsed.map((row) => row.map((v) => parseInt(v) || 0));
    }
  } catch (error) {
    log.warn('Failed to parse external timetable JSON, will use empty weekly:', error);
  }
  return buildEmptyWeeklyArray();
}

async function postExternalTimetableWeekly(svitlobotChannelId, weekly) {
  const timetableData = serializeWeeklyArray(weekly);
  const url = `${svitlobotApiUrl}website/timetableEditEvent?channel_key=${encodeURIComponent(svitlobotChannelId)}&timetableData=${encodeURIComponent(timetableData)}`;
  const response = await axios.get(url);
  return String(response.data || '').trim() === 'ok';
}

async function reflectExternalTimetable(group, dayStr, todayStr, intervals) {
  const svitlobotChannelIds = settings.getGroup(group)?.svitlobotChannelIds || [];
  for (const svitlobotChannelId of svitlobotChannelIds) {
    try {
      let weekly;
      try {
        weekly = await fetchExternalTimetableWeekly(svitlobotChannelId);
      } catch (error) {
        log.warn('Failed to fetch external timetable, will initialize empty weekly:', error);
        weekly = buildEmptyWeeklyArray();
      }

      const weekdayIndex = dayOfWeekIndexFromDateStr(dayStr);
      const isTomorrow = todayStr !== dayStr;
      // If tomorrow is Monday, clear the entire weekly schedule before reflecting
      if (isTomorrow && weekdayIndex === 0) {
        weekly = buildEmptyWeeklyArray();
      }

      const newStates = intervalsToDayStates(intervals);
      weekly[weekdayIndex] = newStates;

      const ok = await postExternalTimetableWeekly(svitlobotChannelId, weekly);
      if (ok) {
        log.info(`External timetable updated for group ${group} on weekday ${weekdayIndex} (${dayStr}).`);
      } else {
        log.warn(`External timetable update for group ${group} on weekday ${weekdayIndex} returned non-ok.`);
      }
    } catch (error) {
      log.error('Failed to reflect external timetable:', error);
    }
  }
}

function buildCalendarEventsCacheKey(calendarId, dayStr) {
  return `${calendarId}:${dayStr}`;
}

function setCalendarEventsCache(calendarId, dayStr, events) {
  const cacheKey = buildCalendarEventsCacheKey(calendarId, dayStr);
  calendarEventsCache.set(cacheKey, events);
}

function clearCalendarEventsCache(calendarId, dayStr) {
  const cacheKey = buildCalendarEventsCacheKey(calendarId, dayStr);
  calendarEventsCache.delete(cacheKey);
}

/**
 * @returns {Promise<boolean>} true when at least one group/day produced calendar changes.
 */
async function processScheduleUpdate(currentData, todayStr) {
  const groupUpdateTimes = currentData.groupUpdates || {};
  const groupStatuses = currentData.statuses || {};
  let changed = false;
  for (const group of [...groups]) {
    const currentGroupData = currentData.intervals[group] || {};
    const updateTime = groupUpdateTimes[group];
    if (!updateTime) {
      log.debug(`No update time for group ${group}, skipping.`);
      continue;
    }
    if (!currentGroupData || Object.keys(currentGroupData).length === 0) {
      log.debug(`No intervals for group ${group}, skipping.`);
      continue;
    }
    for (const dateKey of Object.keys(currentGroupData)) {
      const currentIntervals = currentGroupData[dateKey];
      const currentStatus = groupStatuses?.[group]?.[dateKey] || null;
      log.info(`Going to check schedule for group ${group} on ${dateKey} updated on ${updateTime}.`);
      if (await calendarUpdate(group, currentIntervals, dateKey, todayStr, updateTime, currentStatus)) {
        changed = true;
      }
    }
  }
  return changed;
}

async function readPrivateKey() {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }
  const content = fs.readFileSync(keyFilePath);
  cachedPrivateKey = JSON.parse(content.toString());
  return cachedPrivateKey;
}

async function authenticateToCalendar(key) {
  if (!cachedCalendarAuth) {
    cachedCalendarAuth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [calendarScope, calendarEventsScope],
    });
  }
  await cachedCalendarAuth.authorize();
  return cachedCalendarAuth;
}

function getCalendarService() {
  if (!cachedCalendarService) {
    cachedCalendarService = google.calendar('v3');
  }
  return cachedCalendarService;
}

async function getCalendarEvents(calendar, auth, calendarId, today, todayStr) {
  try {
    const cacheKey = buildCalendarEventsCacheKey(calendarId, todayStr);
    if (calendarEventsCache.has(cacheKey)) {
      log.debug('Returning cached calendar events for:', cacheKey);
      return calendarEventsCache.get(cacheKey);
    }
    const startOfDay = formatStartOfDay(today);
    const endOfDay = formatEndOfDay(today);
    const response = await calendar.events.list({
      auth: auth,
      calendarId: calendarId,
      timeMin: startOfDay,
      timeMax: endOfDay,
      timeZone: timeZone,
    });
    const items = response.data.items;
    setCalendarEventsCache(calendarId, todayStr, items);
    return items;
  } catch (error) {
    log.error('Error fetching calendar events:', error);
    throw error;
  }
}

function prepareCalendarEvent(group, today, interval, updatedOn) {
  const timestamp = formatTz(updatedOn, 'dd.MM.yyyy HH:mm', { timeZone });
  return {
    summary: template(calendarEventSummary, { group }),
    description: template(calendarEventDescription, { timestamp, url: yasnoMainUrl }),
    start: {
      dateTime: formatDateTimeForMinutes(today, interval.startMinutes),
      timeZone: timeZone,
    },
    end: {
      dateTime: formatDateTimeForMinutes(today, interval.endMinutes),
      timeZone: timeZone,
    },
  };
}

function prepareCalendarEvents(group, today, intervals, updatedOn) {
  const events = [];
  for (const interval of intervals) {
    events.push(prepareCalendarEvent(group, today, interval, updatedOn));
  }
  return events;
}

function compareCalendarEvents(events, eventsNew) {
  const eventsToDelete = [];
  const eventsToAdd = [];
  const eventsAreEqual = (eventA, eventB) =>
    eventA.start.dateTime === eventB.start.dateTime && eventA.end.dateTime === eventB.end.dateTime && eventA.summary === eventB.summary;
  for (const event of events) {
    const found = eventsNew.find((eventNew) => eventsAreEqual(event, eventNew));
    if (!found) {
      eventsToDelete.push(event);
    }
  }
  for (const eventNew of eventsNew) {
    const found = events.find((event) => eventsAreEqual(event, eventNew));
    if (!found) {
      eventsToAdd.push(eventNew);
    }
  }
  return { eventsToDelete, eventsToAdd };
}

async function calendarEventsDelete(calendar, auth, calendarId, events, dayStr) {
  if (!events.length) {
    return;
  }
  for (const event of events) {
    try {
      await calendar.events.delete({
        auth: auth,
        calendarId: calendarId,
        eventId: event.id,
      });
    } catch (error) {
      log.error('Error deleting calendar event:', error);
      throw error;
    }
  }
  clearCalendarEventsCache(calendarId, dayStr);
}

async function calendarEventsAdd(calendar, auth, calendarId, events, dayStr) {
  if (!events.length) {
    return;
  }
  for (const event of events) {
    try {
      await calendar.events.insert({
        auth: auth,
        calendarId: calendarId,
        requestBody: event,
      });
    } catch (error) {
      log.error('Error adding calendar event:', error);
      throw error;
    }
  }
  clearCalendarEventsCache(calendarId, dayStr);
}

async function telegramSendUpdate(group, todayStr, dayStr, groupEvents, updatedOn, dayStatus) {
  log.debug(`Sending message for group ${group} for day ${dayStr}. Today is ${todayStr}.`);
  const textForData = todayStr === dayStr ? textToday : textTomorrow;
  const [y, m, d] = dayStr.split('-').map(Number);
  const newDayStr = `${d.toString().padStart(2, '0')}.${m.toString().padStart(2, '0')}.${y}`;
  let message = template(textScheduleUpdated, { today: textForData, date: newDayStr }) + ':';
  let sendingNeeded = true;
  if (groupEvents.length === 0) {
    if (String(dayStatus || '').toLowerCase() === 'emergencyshutdowns') {
      message += `\n${textScheduleEmergencyUnavailable}`;
    } else {
      message += `\n${textScheduleNoOutages}`;
    }
  } else {
    sendingNeeded = false;
    const dateNow = new Date();
    groupEvents.forEach((event) => {
      const eventEnd = new Date(event.end.dateTime);
      if (eventEnd <= dateNow) {
        return;
      }
      sendingNeeded = true;
      message += `\n${template(textScheduleOutageDefiniteLine, { start: event.start.dateTime.slice(11, 16), end: event.end.dateTime.slice(11, 16) })}`;
    });
  }
  if (!sendingNeeded) {
    log.debug(`No upcoming events for group ${group} on ${dayStr}, skipping Telegram notification.`);
    return;
  }
  if (updatedOn) {
    message += `\n${template(textScheduleUpdatedAt, { timestamp: formatUpdatedOn(updatedOn) })}`;
  }
  const targetTitle = telegramTargetTitles[group];
  if (targetTitle === undefined) {
    log.debug(`Telegram is not configured for group ${group}`);
    return;
  }
  const telegramTopicId = settings.getGroup(group)?.telegramTopicId || 0;
  try {
    const messageId = await telegramSendMessage(group, message);
    if (messageId === null) {
      return;
    }
    const previousMessageId = settings.getLastMessageId(group);
    settings.setLastMessageId(group, messageId);
    if (!options.pinMessage) {
      return;
    }
    try {
      await telegramPinMessage(group, messageId);
      log.debug(`Telegram message for group ${group} with id: ${messageId} pinned to "${targetTitle}" with topic ${telegramTopicId}`);
      if (options.unpinPrevious && previousMessageId !== undefined && previousMessageId !== null) {
        try {
          await telegramUnpinMessage(group, previousMessageId);
          log.debug(`Telegram message for group ${group} with id: ${previousMessageId} unpinned from "${targetTitle}" with topic ${telegramTopicId}`);
        } catch (error) {
          log.error(`Error unpinning Telegram message for group ${group} in "${targetTitle}": ${error}`);
        }
      }
    } catch (error) {
      log.error(`Error pinning Telegram message for group ${group} in "${targetTitle}": ${error}`);
    }
  } catch (error) {
    log.error(`Error sending Telegram message for group ${group} to "${targetTitle}": ${error}`);
  }
}

/**
 * @returns {Promise<boolean>} true when calendar events were changed.
 */
async function calendarUpdate(group, intervals, dayStr, todayStr, updatedOn, dayStatus) {
  const eventsNew = prepareCalendarEvents(group, dayStr, intervals, updatedOn);
  log.debug('Events new:', stringify(eventsNew));
  const key = await readPrivateKey();
  const auth = await authenticateToCalendar(key);
  const calendar = getCalendarService();
  const calendarId = settings.getGroup(group)?.calendarId;
  if (!calendarId) {
    log.warn(`Group ${group} has no calendar configured, skipping.`);
    return false;
  }
  const day = parseDateStringAsLocal(dayStr);
  const events = await getCalendarEvents(calendar, auth, calendarId, day, dayStr);
  log.debug('Events:', stringify(events));
  const { eventsToDelete, eventsToAdd } = compareCalendarEvents(events, eventsNew);
  log.debug('Events: to delete:', stringify(eventsToDelete), ', to add:', stringify(eventsToAdd));
  if (eventsToDelete.length === 0 && eventsToAdd.length === 0) {
    return false;
  }
  if (eventsToDelete.length > 0) {
    await calendarEventsDelete(calendar, auth, calendarId, eventsToDelete, dayStr);
  }
  if (eventsToAdd.length > 0) {
    await calendarEventsAdd(calendar, auth, calendarId, eventsToAdd, dayStr);
  }
  await telegramSendUpdate(group, todayStr, dayStr, eventsNew, updatedOn, dayStatus);
  // Reflect changes on the external weekly timetable site (svitlobot)
  await reflectExternalTimetable(group, dayStr, todayStr, intervals);
  return true;
}

// -------- Telegram clients --------

async function askQuestion(question) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function getAPIAttributes() {
  const stored = settings.getApiCredentials();
  if (stored !== null) {
    return stored;
  }
  const apiId = parseInt(await askQuestion('Enter your API ID: '), 10);
  const apiHash = (await askQuestion('Enter your API Hash: ')).trim();
  if (!Number.isInteger(apiId) || apiId <= 0 || apiHash.length === 0) {
    throw new Error('Invalid API ID or API Hash');
  }
  settings.setApiCredentials({ apiId, apiHash });
  return { apiId, apiHash };
}

async function getBotAuthToken() {
  const stored = settings.getBotToken();
  if (stored !== null) {
    return stored;
  }
  const token = (await askQuestion('Enter your Bot Auth Token: ')).trim();
  if (token.length < BOT_TOKEN_MIN_LENGTH) {
    throw new Error('Invalid Bot Auth Token');
  }
  settings.setBotToken(token);
  return token;
}

async function getUserClient() {
  const storeSession = new StoreSession(sessionDir);
  const { apiId, apiHash } = await getAPIAttributes();
  const client = new TelegramClient(storeSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
    connectionTimeout: 10000,
    appVersion: `${scriptName} v${scriptVersion}`,
  });
  await client.start({
    phoneNumber: async () => askQuestion('Enter your phone number: '),
    phoneCode: async () => askQuestion('Enter the code sent to your phone: '),
    password: async () => askQuestion('Enter your password: '),
    onError: (error) => {
      log.error(`Telegram client error: ${error}`);
    },
  });
  log.debug('Telegram client is connected');
  client.setParseMode(telegramParseMode);
  return client;
}

async function getTelegramClient() {
  if (options.asUser === true) {
    return getUserClient();
  }
  const token = await getBotAuthToken();
  telegramBot = new Bot(token);
  return telegramBot.api;
}

async function getTelegramTargetEntity(group) {
  const groupConfig = settings.getGroup(group);
  const telegramChatId = groupConfig?.telegramChatId ?? null;
  const telegramTopicId = groupConfig?.telegramTopicId ?? 0;
  delete telegramTargetEntities[group];
  delete telegramTargetTitles[group];
  if (typeof telegramChatId !== 'number' || telegramChatId === 0) {
    log.warn(`Telegram chat ID for group ${group} is not valid! No notification will be sent!`);
    return;
  }
  if (options.asUser === false) {
    const entity = await telegramClient.getChat(telegramChatId);
    telegramTargetTitles[group] = entity.title || `${entity.first_name || ''} ${entity.last_name || ''} (${entity.username || ''})`;
    log.debug(`Telegram chat "${telegramTargetTitles[group]}" with ID ${telegramChatId} found!`);
    telegramTargetEntities[group] = entity;
    return;
  }
  const dialogs = await telegramClient.getDialogs();
  let chatId = telegramChatId > 0 ? telegramChatId : -telegramChatId;
  if (chatId > 1000000000000) {
    chatId = chatId - 1000000000000;
  }
  const availableDialogs = dialogs.filter((dialog) => dialog.entity?.migratedTo === undefined || dialog.entity?.migratedTo === null);
  const targetDialog = availableDialogs.find((item) => `${chatId}` === `${item.entity.id}`);
  if (targetDialog === undefined) {
    throw new Error(`Telegram chat with ID ${telegramChatId} not found`);
  }
  const title =
    targetDialog.entity.title ||
    `${targetDialog.entity.firstName || ''} ${targetDialog.entity.lastName || ''} (${targetDialog.entity.username || ''})`;
  if (telegramTopicId > 0) {
    const response = await telegramClient.invoke(
      new Api.messages.GetForumTopics({
        peer: targetDialog.entity,
        q: '',
        limit: 100,
        offsetId: 0,
        offsetDate: 0,
        offsetTopic: 0,
      }),
    );
    if (!Array.isArray(response.topics) || response.topics.length === 0) {
      throw new Error(`No topics found in "${title}" (${telegramChatId})!`);
    }
    const targetTopic = response.topics.find((topic) => topic.id === telegramTopicId);
    if (!targetTopic) {
      throw new Error(`Topic with id ${telegramTopicId} not found in "${title}" (${telegramChatId})!`);
    }
    log.debug(`Telegram topic "${targetTopic.title}" in chat "${title}" with ID ${telegramChatId} found!`);
  } else {
    log.debug(`Telegram chat "${title}" with ID ${telegramChatId} found!`);
  }
  telegramTargetTitles[group] = title;
  telegramTargetEntities[group] = targetDialog.entity;
}

async function telegramSendMessage(group, messageText) {
  if (telegramClient === null || telegramTargetEntities[group] === undefined) {
    throw new Error('Telegram client is not ready!');
  }
  const telegramTargetTitle = telegramTargetTitles[group];
  const groupConfig = settings.getGroup(group);
  const telegramTopicId = groupConfig?.telegramTopicId || 0;
  let message;
  if (options.asUser === true) {
    const telegramMessage = { message: messageText };
    if (telegramTopicId > 0) {
      telegramMessage.replyTo = telegramTopicId;
    }
    message = await telegramClient.sendMessage(telegramTargetEntities[group], telegramMessage);
  } else {
    const messageOptions = { parse_mode: telegramParseMode };
    if (telegramTopicId > 0) {
      messageOptions.message_thread_id = telegramTopicId;
    }
    message = await telegramClient.sendMessage(groupConfig.telegramChatId, messageText, messageOptions);
  }
  const messageId = options.asUser === true ? message.id : message.message_id;
  log.debug(`Telegram message sent to "${telegramTargetTitle}" with topic ${telegramTopicId} with messageId: ${messageId}`);
  return messageId;
}

async function telegramPinMessage(group, messageId) {
  const target = telegramTargetEntities[group];
  if (telegramClient === null || target === undefined) {
    throw new Error('Telegram client is not ready!');
  }
  if (options.asUser === true) {
    await telegramClient.pinMessage(target, messageId);
  } else {
    await telegramClient.pinChatMessage(settings.getGroup(group).telegramChatId, messageId);
  }
}

async function telegramUnpinMessage(group, messageId) {
  const target = telegramTargetEntities[group];
  if (telegramClient === null || target === undefined) {
    throw new Error('Telegram client is not ready!');
  }
  if (options.asUser === true) {
    await telegramClient.unpinMessage(target, messageId);
  } else {
    await telegramClient.unpinChatMessage(settings.getGroup(group).telegramChatId, messageId);
  }
}

// -------- Management interface --------

function buildGroupStatus(groupId) {
  const group = settings.getGroup(groupId);
  return {
    id: groupId,
    ...group,
    chatTitle: telegramTargetTitles[groupId] ?? null,
  };
}

const managementController = {
  getAdminIds: () => settings.getAdminIds(),
  addAdmin: (userId) => settings.setAdminIds([...settings.getAdminIds(), userId]),
  removeAdmin: (userId) => {
    const remaining = settings.getAdminIds().filter((id) => id !== userId);
    if (remaining.length === 0) {
      throw new Error('At least one admin must remain.');
    }
    settings.setAdminIds(remaining);
  },
  getStatus: () => ({
    name: scriptName,
    version: scriptVersion,
    mode: options.asUser ? 'user' : 'bot',
    language: options.language,
    options: { ...options },
    groups: settings.knownGroupIds().map(buildGroupStatus),
    startedAt: runtime.startedAt,
    lastCheckAt: runtime.lastCheckAt,
    lastChangeAt: runtime.lastChangeAt,
    lastError: runtime.lastError,
    nextCheckAt: runtime.nextCheckAt,
    checkInProgress: runtime.checkInProgress,
    storagePath: settings.filePath,
  }),
  getGroup: (groupId) => buildGroupStatus(groupId),
  getYasnoGroupIds: () => settings.getYasnoGroupIds(),
  getSchedule: () => runtime.lastSchedule,
  getKnownStatuses: () => settings.getKnownYasnoStatuses(),
  forceCheck: () => checkForUpdates({ force: true }),
  setGroupField: async (groupId, field, value) => {
    settings.setGroupField(groupId, field, value);
    refreshGroups();
    if (field === 'telegramChatId' || field === 'telegramTopicId') {
      await getTelegramTargetEntity(groupId);
    }
    lastYasnoChecksum = null; // make the next check re-evaluate the new configuration
    return buildGroupStatus(groupId);
  },
  unsetGroupField: async (groupId, field) => {
    settings.unsetGroupField(groupId, field);
    refreshGroups();
    if (field === 'telegramChatId') {
      delete telegramTargetEntities[groupId];
      delete telegramTargetTitles[groupId];
    } else if (field === 'telegramTopicId') {
      await getTelegramTargetEntity(groupId);
    }
    lastYasnoChecksum = null;
    return buildGroupStatus(groupId);
  },
  removeGroup: async (groupId) => {
    settings.removeGroup(groupId);
    refreshGroups();
    delete telegramTargetEntities[groupId];
    delete telegramTargetTitles[groupId];
    lastYasnoChecksum = null;
  },
  setOption: async (name, value) => {
    switch (name) {
      case 'scheduleUpdateInterval': {
        options.scheduleUpdateInterval = parseInterval(value);
        scheduleChecks();
        break;
      }
      case 'debug': {
        options.debug = Boolean(value);
        log.setLevel(options.debug ? 'debug' : 'info');
        break;
      }
      case 'pinMessage':
      case 'unpinPrevious':
      case 'ignoreStatus': {
        options[name] = Boolean(value);
        if (name === 'ignoreStatus') {
          lastYasnoChecksum = null;
        }
        break;
      }
      default:
        throw new Error(`Unknown option: ${name}`);
    }
    settings.setOption(name, options[name]);
    log.info(`Option ${name} set to ${options[name]} via management interface`);
    return options[name];
  },
};

async function startManagement() {
  const adminIds = settings.getAdminIds();
  if (adminIds.length === 0) {
    log.info('Management interface disabled: no admin ids configured (set TELEGRAM_ADMIN_IDS or --admin-ids).');
    return;
  }
  const managementToken = settings.getManagementBotToken();
  if (managementToken !== null) {
    managementBot = new Bot(managementToken);
  } else if (telegramBot !== null) {
    managementBot = telegramBot;
  } else {
    managementBot = new Bot(await getBotAuthToken());
  }
  management = createManagementBot({ bot: managementBot, controller: managementController, i18n, logger: log, timeZone });
  await management.start();
}

// -------- Lifecycle --------

let exiting = false;

async function gracefulExit() {
  if (exiting) {
    return;
  }
  exiting = true;
  if (checkTimer !== null) {
    clearInterval(checkTimer);
  }
  try {
    if (management !== null) {
      await management.stop();
      log.info('Management interface is stopped!');
    }
  } catch (error) {
    log.error(`Error stopping management interface: ${error}`);
  }
  if (telegramClient !== null && options.asUser === true) {
    try {
      if (telegramClient.connected === true) {
        await telegramClient.disconnect();
        log.info('Telegram client is disconnected!');
      }
      await telegramClient.destroy();
      log.info('Telegram client is destroyed!');
    } catch (error) {
      log.error(`Error while disconnecting Telegram client: ${error}`);
    }
  }
  log.info('All clients are disconnected!');
  exit(0);
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

(async () => {
  try {
    telegramClient = await getTelegramClient();
    for (const group of groups) {
      try {
        await getTelegramTargetEntity(group);
      } catch (error) {
        log.warn(`Telegram target for group ${group} is not available: ${error}`);
      }
    }
    await startManagement();
    scheduleChecks();
    // Initial check
    await checkForUpdates();
  } catch (error) {
    log.error(`Error: ${error?.stack || error}`);
    await gracefulExit();
  }
})();
