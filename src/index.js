const { Api, TelegramClient } = require('telegram');
const { Api: GrammyApi } = require('grammy');
const { StringSession, StoreSession } = require('telegram/sessions');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output, exit } = require('node:process');
const stringify = require('json-stringify-safe');
const { LocalStorage } = require('node-localstorage');
const yargsParser = require('yargs-parser');
const { Cache } = require('./modules/cache/Cache');
const { securedLogger: log } = require('./modules/logging/logging');
const { name: scriptName, version: scriptVersion } = require('./version');
const i18n = require('./modules/i18n/i18n.config');
const axios = require('axios');
const fs = require('node:fs');
const { toZonedTime, format: formatTz } = require('date-fns-tz');
const template = require('string-template');
const { google } = require('googleapis');


const timeZone = 'Europe/Kiev'; // Replace with your desired time zone

const parsedArgs = yargsParser(process.argv.slice(2), {
  alias: {
    i: 'schedule-update-interval',
    l: 'language',
    d: 'debug',
    h: 'help',
  },
  boolean: ['as-user', 'debug', 'help', 'pin-message', 'unpin-previous', 'ignore-status'],
  configuration: {
    'camel-case-expansion': true,
  },
  string: ['language'],
  default: {
    'schedule-update-interval': 5,
    language: 'uk',
  },
});

if (parsedArgs.help) {
  output.write(`Usage: ${scriptName} [options]\n\n`);
  output.write('Options:\n');
  output.write('  --as-user                 Start as user instance (bot instance by default)\n');
  output.write('  -i, --schedule-update-interval <minutes>   Update interval for schedule in minutes (1-120)\n');
  output.write('  -l, --language <code>     Language code for i18n (default: uk)\n');
  output.write('  -d, --debug               Enable debug level logging\n');
  output.write('  --pin-message             Pin update messages in Telegram\n');
  output.write('  --unpin-previous          Unpin previous messages after pinning a new one\n');
  output.write('  --ignore-status           Process schedules even if status is not ScheduleApplies\n');
  output.write('  -h, --help                Show this help and exit\n');
  output.write('      --version             Show version number and exit\n');
  exit(0);
}

if (parsedArgs.version) {
  output.write(`${scriptVersion}\n`);
  exit(0);
}

const resolvedInterval = Number(
  parsedArgs.scheduleUpdateInterval ?? parsedArgs['schedule-update-interval'],
);

if (!Number.isFinite(resolvedInterval) || resolvedInterval < 1 || resolvedInterval > 120) {
  output.write('Error: schedule update interval must be a number between 1 and 120 minutes.\n');
  exit(1);
}

const options = {
  asUser: Boolean(parsedArgs.asUser ?? parsedArgs['as-user']),
  scheduleUpdateInterval: resolvedInterval,
  language: parsedArgs.language,
  debug: Boolean(parsedArgs.debug),
  pinMessage: Boolean(parsedArgs.pinMessage ?? parsedArgs['pin-message']),
  unpinPrevious: Boolean(parsedArgs.unpinPrevious ?? parsedArgs['unpin-previous']),
  ignoreStatus: Boolean(parsedArgs.ignoreStatus ?? parsedArgs['ignore-status']),
};

log.setTimeZone(timeZone);
if (options.debug) {
  log.setLevel('debug');
}


i18n.setLocale(options.language);


log.info(`Starting ${scriptName} v${scriptVersion} ...`);
log.info(`As user: ${options.asUser}`);
log.info(`Language: ${options.language}`);
log.info(`Schedule update interval: ${options.scheduleUpdateInterval} minutes`);
log.info(`Debug: ${options.debug}`);

const groups = [];

log.appendMaskWord(...groups.map((group) => `calendarIdGroup${group}`));



const yasnoApiUrl = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages';
const yasnoMainUrl = 'https://static.yasno.ua/kyiv/outages';
let previousData = null;

const storage = new LocalStorage('data/storage');
const cache = new Cache({
  getItem: (key) => storage.getItem(key),
  setItem: (key, value) => storage.setItem(key, value),
  removeItem: (key) => storage.removeItem(key),
});

const keyFilePath = 'data/yasno-monitor.json'; // path to JSON with private key been downloaded from Google
const calendarScope = 'https://www.googleapis.com/auth/calendar'; // authorization scopes
const calendarEventsScope = 'https://www.googleapis.com/auth/calendar.events';

const calendarEventSummary = i18n.__('Power outage. Group {group}');
const calendarEventDescription = i18n.__('Planned power outage by information from {url}, on {timestamp}');


const textScheduleUpdated = i18n.__('Schedule for {today} ({date}) has been updated');
const textToday = i18n.__('today');
const textTomorrow = i18n.__('tomorrow');
const textScheduleOutageDefiniteLine = i18n.__('- off: {start} - {end}');
const textScheduleUpdatedAt = i18n.__('Data updated at {timestamp}');
const textScheduleNotApplies = i18n.__('Schedule not in effect yet.');




let telegramClient = null;
let telegramTargetEntities = {};
let telegramTargetTitles = {};

const botAuthTokenMinimumLength = 43;

const telegramParseMode = 'html';

for (let group = 1; group <= 6; group++) {
  const oldCalendarId = cache.getItem(`calendarIdGroup${group}`);
  if (typeof oldCalendarId === 'string' && oldCalendarId.length > 0) {
    cache.setItem(`calendarIdGroup${group}.1`, oldCalendarId);
    cache.removeItem(`calendarIdGroup${group}`);
  }
  const oldTelegramChatId = cache.getItem(`telegramChatIdGroup${group}`);
  if (typeof oldTelegramChatId === 'number' && oldTelegramChatId !== 0) {
    cache.setItem(`telegramChatIdGroup${group}.1`, oldTelegramChatId);
    cache.removeItem(`telegramChatIdGroup${group}`);
  }
  const oldTelegramTopicId = cache.getItem(`telegramTopicIdGroup${group}`);
  if (typeof oldTelegramTopicId === 'number' && oldTelegramTopicId >= 0) {
    cache.setItem(`telegramTopicIdGroup${group}.1`, oldTelegramTopicId);
    cache.removeItem(`telegramTopicIdGroup${group}`);
  }
  for (let subGroup = 1; subGroup <= 2; subGroup++) {
    const envId = `${group}_${subGroup}`;
    const groupId = `${group}.${subGroup}`;
    if (typeof process.env[`CALENDAR_ID_GROUP_${envId}`] === 'string' && process.env[`CALENDAR_ID_GROUP_${envId}`].length > 0) {
      cache.setItem(`calendarIdGroup${groupId}`, process.env[`CALENDAR_ID_GROUP_${envId}`]);
    }
    if (typeof process.env[`TELEGRAM_CHAT_ID_GROUP_${envId}`] === 'string' && process.env[`TELEGRAM_CHAT_ID_GROUP_${envId}`].length > 0) {
      cache.setItem(`telegramChatIdGroup${groupId}`, parseInt(process.env[`TELEGRAM_CHAT_ID_GROUP_${envId}`]));
    }
    if (typeof process.env[`TELEGRAM_TOPIC_ID_GROUP_${envId}`] === 'string' && process.env[`TELEGRAM_TOPIC_ID_GROUP_${envId}`].length > 0) {
      cache.setItem(`telegramTopicIdGroup${groupId}`, parseInt(process.env[`TELEGRAM_TOPIC_ID_GROUP_${envId}`]));
    }
    const calendarId = cache.getItem(`calendarIdGroup${groupId}`);
    if (typeof calendarId === 'string' && calendarId.length > 0) {
      groups.push(groupId);
    }
  }

};


async function checkForUpdates() {
  let currentData;
  const today = toZonedTime(new Date(), timeZone);
  const todayStr = formatDateInZone(today, timeZone);
  log.debug(`Checking for updates, today is ${todayStr} ...`);
  try {
    const response = await axios.get(yasnoApiUrl);
    currentData = transformPlannedOutages(response.data, todayStr);
    if (!currentData) {
      log.error('Unable to process planned outage payload.');
      return;
    }
  } catch (error) {
    log.error('Error fetching planned outage data:', error);
    return;
  }

  if (!currentData || !currentData.intervals) {
    log.error('No valid intervals found in processed data.');
    return;
  }

  try {
    await processScheduleUpdate(currentData, previousData, todayStr);
    previousData = currentData;
  } catch (error) {
    log.error('Failed to process planned outage update:', error?.stack || error);
  }
}

function transformPlannedOutages(payload, todayStr) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const intervals = {};
  const groupUpdates = {};
  const relevantGroups = groups.length > 0 ? groups : Object.keys(payload);

  for (const group of relevantGroups) {
    const groupData = payload[group];
    if (!groupData) {
      log.warn(`No planned outage data returned for group ${group}`);
      intervals[group] =  {todayStr: []};
      groupUpdates[group] = new Date();
      continue;
    } else {
      intervals[group] = {};
    }

    const groupUpdatedOn = new Date(groupData.updatedOn);
    if (Number.isNaN(groupUpdatedOn.getTime())) {
      log.warn(`No information about updatedOn for group ${group}`);
      continue;
    }
    groupUpdates[group] = groupUpdatedOn;
    for (const dayKey of Object.keys(groupData)) {

      const dayData = groupData[dayKey];
      if (!dayData || !Array.isArray(dayData.slots)) {
        continue;
      }

      const dayValue = new Date(dayData.date);
      if (Number.isNaN(dayValue.getTime())) {
        log.warn(`Invalid date value for group ${group} on ${dayKey}: ${dayData.date}`);
        continue;
      }
      
      const dayDateStr = formatDateInZone(dayValue, timeZone);
      intervals[group][dayDateStr] = [];
  
      const scheduleApplies = String(dayData.status || '').toLowerCase() === 'scheduleapplies'.toLowerCase();
      if (!scheduleApplies && !options.ignoreStatus) {
        log.debug(`Schedule does not apply for group ${group} on ${dayKey} (${dayData.date}).`);
        continue;
      }

      if (parseInt(dayDateStr, 10) < parseInt(todayStr, 10)) {
        log.debug(`Day ${dayDateStr} is in the past for group ${group} on ${dayKey}.`);
        continue;
      }
      intervals[group][dayDateStr] = buildIntervalsFromSlots(dayData.slots);
    }
  }

  return {
    intervals,
    groupUpdates
  };
}

function formatDateInZone(date = new Date(), timeZone = "Europe/Kiev") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone
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
  const [y, m, d] = dateStr.split("-").map(Number);
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
  return formatTz(date, 'dd.MM.yyyy HH:mm', { timeZone });
}

async function processScheduleUpdate(
  currentData,
  previousData,
  todayStr
) {
  const groupUpdateTimes = currentData.groupUpdates || {};
  for (const group of groups) {
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
    const previousGroupData = previousData ? previousData.intervals[group] || {} : {};
    if (stringify(currentGroupData) === stringify(previousGroupData)) {
      log.debug(`No changes in schedule for group ${group}.`);
      continue;
    }
    for (const dateKey of Object.keys(currentGroupData)) {
      const currentIntervals = currentGroupData[dateKey];
      const previousIntervals = previousGroupData[dateKey];
      if (!previousIntervals || stringify(currentIntervals) !== stringify(previousIntervals)) {
        log.info(`Schedule for group ${group} on ${dateKey} has been updated on ${updateTime}.`);
        await calendarUpdate(group, currentIntervals, dateKey, todayStr, updateTime);
      } else {
        log.debug(`No changes in schedule for group ${group} on ${dateKey}.`);
      }
    }
  };
}

async function readPrivateKey() {
  const content = fs.readFileSync(keyFilePath);
  return JSON.parse(content.toString());
}

async function authenticateToCalendar(key) {
  const jwtClient = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [calendarScope, calendarEventsScope],
  });
  await jwtClient.authorize();
  return jwtClient;
}


async function getCalendarEvents(calendar, auth, calendarId, today) {
  try {
    const startOfDay = formatStartOfDay(today);
    const endOfDay = formatEndOfDay(today);
    const response = await calendar.events.list({
      auth: auth,
      calendarId: calendarId,
      timeMin: startOfDay,
      timeMax: endOfDay,
      timeZone: timeZone
    });
    return response.data.items;
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    throw error;
  }
}


function prepareCalendarEvent(group, today, interval, updatedOn) {
  const timestamp = formatTz(updatedOn, "dd.MM.yyyy HH:mm", { timeZone });
  return {
    summary: template(calendarEventSummary, { group }),
    description: template(calendarEventDescription, { timestamp, url: yasnoMainUrl }),
    start: {
      dateTime: formatDateTimeForMinutes(today, interval.startMinutes),
      timeZone: timeZone
    },
    end: {
      dateTime: formatDateTimeForMinutes(today, interval.endMinutes),
      timeZone: timeZone
    }
  }
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
  const eventsAreEqual = (eventA, eventB) => eventA.start.dateTime === eventB.start.dateTime && eventA.end.dateTime === eventB.end.dateTime && eventA.summary === eventB.summary;
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

async function calendarEventsDelete(calendar, auth, calendarId, events) {
  for (const event of events) {
    try {
      await calendar.events.delete({
        auth: auth,
        calendarId: calendarId,
        eventId: event.id
      });
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      throw error;
    }
  }
}

async function calendarEventsAdd(calendar, auth, calendarId, events) {
  for (const event of events) {
    try {
      await calendar.events.insert({
        auth: auth,
        calendarId: calendarId,
        requestBody: event
      });
    } catch (error) {
      console.error('Error adding calendar event:', error);
      throw error;
    }
  }
}


async function telegramSendUpdate(group, todayStr, dayStr, groupEvents, updatedOn) {
  const textForData = todayStr === dayStr ? textToday : textTomorrow;
  const [y, m, d] = dayStr.split("-").map(Number);
  const newDayStr = `${d.toString().padStart(2, '0')}.${m.toString().padStart(2, '0')}.${y}`;
  let message = template(textScheduleUpdated, { today: textForData, date: newDayStr }) + ':';
  if (groupEvents.length === 0) {
    message += `\n${i18n.__('no outages!')}`;
  } else {
    groupEvents.forEach((event) => {
      message += `\n${template(textScheduleOutageDefiniteLine, { start: event.start.dateTime.slice(11, 16), end: event.end.dateTime.slice(11, 16) })
        }`;
    });
  }
  if (updatedOn) {
    message += `\n${template(textScheduleUpdatedAt, { timestamp: formatUpdatedOn(updatedOn) })}`;
  }
  const targetTitle = telegramTargetTitles[group];
  if (targetTitle !== undefined) {
    try {
      const messageId = await telegramSendMessage(group, message);
      if (messageId !== null) {
        const cacheIdLastMessageId = `lastMessageIdGroup${group}`;
        const previousMessageId = cache.getItem(cacheIdLastMessageId, 'number');
        cache.setItem(cacheIdLastMessageId, messageId);
        if (options.pinMessage) {
          try {
            await telegramPinMessage(group, messageId)
            log.debug(`Telegram message for group ${group} with id: ${messageId} pinned to "${targetTitle}" with topic ${telegramTopicId}`);
            if (options.unpinPrevious) {
              if (previousMessageId !== undefined && previousMessageId !== null) {
                try {
                  await telegramUnpinMessage(group, previousMessageId);
                  log.debug(
                    `Telegram message for group ${group} with id: ${previousMessageId} unpinned from "${targetTitle}" with topic ${telegramTopicId}`,
                  );
                } catch (error) {
                  log.error(`Error unpinning Telegram message for group ${group} in "${targetTitle}": ${error}`);
                }
              }
            }
          } catch (error) {
            log.error(`Error pinning Telegram message for group ${group} in "${targetTitle}": ${error}`);
          }
        }
      }
    } catch (error) {
      log.error(`Error sending Telegram message for group ${group} to "${targetTitle}": ${error}`);
    }
  } else {
    log.debug(`Telegram is not configured for group ${group}`);
  }
}

async function calendarUpdate(group, intervals, dayStr, todayStr, updatedOn) {
  const eventsNew = prepareCalendarEvents(group, dayStr, intervals, updatedOn);
  log.debug('Events new:', stringify(eventsNew));
  const auth = await authenticateToCalendar(await readPrivateKey());
  const calendar = google.calendar('v3');
  const calendarId = cache.getItem(`calendarIdGroup${group}`);
  const day = parseDateStringAsLocal(dayStr);
  const events = await getCalendarEvents(calendar, auth, calendarId, day);
  log.debug('Events:', stringify(events));
  const { eventsToDelete, eventsToAdd } = compareCalendarEvents(events, eventsNew);
  log.debug('Events to delete:', stringify(eventsToDelete));
  log.debug('Events to add:', stringify(eventsToAdd));
  await calendarEventsDelete(calendar, auth, calendarId, eventsToDelete);
  await calendarEventsAdd(calendar, auth, calendarId, eventsToAdd);
  if (eventsToDelete.length > 0 || eventsToAdd.length > 0) {
    await telegramSendUpdate(group, todayStr, dayStr, eventsNew, updatedOn);
  }
}

function getAPIAttributes() {
  return new Promise((resolve, reject) => {
    const apiId = cache.getItem('telegramApiId', 'number');
    const apiHash = cache.getItem('telegramApiHash', 'string');
    if (typeof apiId !== 'number' || apiId <= 0 || typeof apiHash !== 'string' || apiHash.length < 1) {
      const rl = readline.createInterface({
        input,
        output,
      });
      rl.question('Enter your API ID: ')
        .then((id) => {
          const newApiId = parseInt(id);
          cache.setItem('telegramApiId', newApiId);
          rl.question('Enter your API Hash: ')
            .then((hash) => {
              cache.setItem('telegramApiHash', hash);
              rl.close();
              resolve({ apiID: newApiId, hash });
            })
            .catch((error) => {
              log.error(`Error: ${error}`);
              rl.close();
              reject(error);
            });
        })
        .catch((error) => {
          log.error(`Error: ${error}`);
          rl.close();
          reject(error);
        });
    } else {
      resolve({ apiId, apiHash });
    }
  });
}

function getBotAuthToken() {
  return new Promise((resolve, reject) => {
    const botAuthToken = cache.getItem('telegramBotAuthToken');
    if (typeof botAuthToken !== 'string' || botAuthToken.length < botAuthTokenMinimumLength) {
      const rl = readline.createInterface({
        input,
        output,
      });
      rl.question('Enter your Bot Auth Token: ')
        .then((token) => {
          cache.setItem('telegramBotAuthToken', token);
          rl.close();
          resolve(token);
        })
        .catch((error) => {
          log.error(`Error: ${error}`);
          rl.close();
          reject(error);
        });
    } else {
      resolve(botAuthToken);
    }
  });
}

function getTelegramClient() {
  return new Promise((resolve, reject) => {
    if (options.asUser === true) {
      const storeSession = new StoreSession(`data/session`);
      if (typeof process.env.TELEGRAM_API_ID === 'string' && process.env.TELEGRAM_API_ID.length > 0) {
        cache.setItem('telegramApiId', parseInt(process.env.TELEGRAM_API_ID));
      }
      if (typeof process.env.TELEGRAM_API_HASH === 'string' && process.env.TELEGRAM_API_HASH.length > 0) {
        cache.setItem('telegramApiHash', process.env.TELEGRAM_API_HASH);
      }
      getAPIAttributes()
        .then(({ apiId, apiHash }) => {
          const client = new TelegramClient(storeSession, apiId, apiHash, {
            connectionRetries: 5,
            useWSS: true,
            connectionTimeout: 10000,
            appVersion: `${scriptName} v${scriptVersion}`,
          });
          const rl = readline.createInterface({
            input,
            output,
          });
          client
            .start({
              phoneNumber: async () => {
                return rl.question('Enter your phone number: ');
              },
              phoneCode: async () => {
                return rl.question('Enter the code sent to your phone: ');
              },
              password: async () => {
                return rl.question('Enter your password: ');
              },
              onError: (error) => {
                log.error(`Telegram client error: ${error}`);
              },
            })
            .then(() => {
              rl.close();
              log.debug('Telegram client is connected');
              client.setParseMode(telegramParseMode);
              resolve(client);
            })
            .catch((error) => {
              rl.close();
              log.error(`Telegram client connection error: ${error}`);
              reject(error);
            });
        })
        .catch((error) => {
          log.error(`API attributes error: ${error}!`);
          reject(error);
        });
    } else {
      if (
        typeof process.env.TELEGRAM_BOT_AUTH_TOKEN === 'string' &&
        process.env.TELEGRAM_BOT_AUTH_TOKEN.length >= botAuthTokenMinimumLength
      ) {
        cache.setItem('telegramBotAuthToken', process.env.TELEGRAM_BOT_AUTH_TOKEN);
      }
      getBotAuthToken()
        .then((token) => {
          const client = new GrammyApi(token);
          resolve(client);
        })
        .catch((error) => {
          log.error(`Bot Auth Token error: ${error}`);
          reject(error);
        });
    }
  });
}

function getTelegramTargetEntity(group) {
  return new Promise((resolve, reject) => {
    const telegramChatId = cache.getItem(`telegramChatIdGroup${group}`, 'number');
    const telegramTopicId = cache.getItem(`telegramTopicIdGroup${group}`, 'number');
    if (typeof telegramChatId !== 'number' || telegramChatId == 0) {
      log.warn(`Telegram chat ID for group ${group} is not valid! No notification will be sent!`);
      resolve();
    } else {
      if (options.asUser === false) {
        telegramClient
          .getChat(telegramChatId)
          .then((entity) => {
            telegramTargetTitles[group] = entity.title || `${entity.first_name || ''} ${entity.last_name || ''} (${entity.username || ''})`;
            log.debug(`Telegram chat "${telegramTargetTitles[group]}" with ID ${telegramChatId} found!`);
            telegramTargetEntities[group] = entity;
            resolve();
          })
          .catch((error) => {
            log.warn(`Telegram chat with ID ${telegramChatId} not found! Error: ${error}`);
            reject(error);
          });
      } else {
        telegramClient
          .getDialogs()
          .then((dialogs) => {
            let chatId = telegramChatId > 0 ? telegramChatId : -telegramChatId;
            if (chatId > 1000000000000) {
              chatId = chatId - 1000000000000;
            }
            const availableDialogs = dialogs.filter(
              (dialog) => dialog.entity?.migratedTo === undefined || dialog.entity?.migratedTo === null,
            ),
              targetDialog = availableDialogs.find((item) => `${chatId}` === `${item.entity.id}`);
            if (targetDialog !== undefined) {
              telegramTargetTitles[group] =
                targetDialog.entity.title ||
                `${targetDialog.entity.firstName || ''} ${targetDialog.entity.lastName || ''} (${targetDialog.entity.username || ''})`;
              if (telegramTopicId > 0) {
                telegramClient
                  .invoke(
                    new Api.channels.GetForumTopics({
                      channel: targetDialog.entity,
                      limit: 100,
                      offsetId: 0,
                      offsetDate: 0,
                      addOffset: 0,
                    }),
                  )
                  .then((response) => {
                    if (Array.isArray(response.topics) && response.topics.length > 0) {
                      // eslint-disable-next-line sonarjs/no-nested-functions
                      const targetTopic = response.topics.find((topic) => topic.id === telegramTopicId);
                      if (targetTopic) {
                        log.debug(`Telegram topic "${targetTopic.title}" in chat "${telegramTargetTitles[group]}" with ID ${telegramChatId} found!`);
                        telegramTargetEntities[group] = targetDialog.entity;
                        resolve();
                      } else {
                        log.warn(`Topic with id ${telegramTopicId} not found in "${telegramTargetTitles[group]}" (${telegramChatId})!`);
                        reject(new Error(`Topic with id ${telegramTopicId} not found in "${telegramTargetTitles[group]}" (${telegramChatId})!`));
                      }
                    } else {
                      log.warn(`No topics found in "${telegramTargetTitles[group]}" (${telegramChatId})!`);
                      reject(new Error(`No topics found in "${telegramTargetTitles[group]}" (${telegramChatId})!`));
                    }
                  })
                  .catch((error) => {
                    reject(error);
                  });
              } else {
                log.debug(`Telegram chat "${telegramTargetTitles[group]}" with ID ${telegramChatId} found!`);
                telegramTargetEntities[group] = targetDialog.entity;
                resolve();
              }
            } else {
              reject(new Error(`Telegram chat with ID ${telegramChatId} not found`));
            }
          })
          .catch((error) => {
            reject(error);
          });
      }
    }
  });
}

function telegramSendMessage(group, messageText) {
  return new Promise((resolve, reject) => {
    if (telegramClient !== null && telegramTargetEntities[group] !== undefined) {
      let telegramMessage;
      let telegramTarget;
      let messageOptions;
      const telegramTargetTitle = telegramTargetTitles[group];
      const telegramTopicId = cache.getItem(`telegramTopicIdGroup${group}`, 'number') || 0;
      if (options.asUser === true) {
        telegramMessage = {
          message: messageText,
        };
        if (telegramTopicId > 0) {
          telegramMessage.replyTo = telegramTopicId;
        }
        telegramTarget = telegramTargetEntities[group];
      } else {
        telegramMessage = messageText;
        telegramTarget = cache.getItem(`telegramChatIdGroup${group}`, 'number') || 0;;
        messageOptions = {
          parse_mode: telegramParseMode,
        };
        if (telegramTopicId > 0) {
          messageOptions.message_thread_id = telegramTopicId;
        }
      }
      telegramClient
        .sendMessage(telegramTarget, telegramMessage, messageOptions)
        .then((message) => {
          const messageId = options.asUser === true ? message.id : message.message_id;
          log.debug(`Telegram message sent to "${telegramTargetTitle}" with topic ${telegramTopicId} with messageId: ${messageId}`);
          resolve(messageId);
        })
        .catch((error) => {
          reject(error);
        });
    } else {
      reject(new Error('Telegram client is not ready!'));
    }
  });
}

function telegramPinMessage(group, messageId) {
  return new Promise((resolve, reject) => {
    const target = telegramTargetEntities[group];
    if (telegramClient !== null && target !== undefined) {
      if (options.asUser === true) {
        telegramClient
          .pinMessage(target, messageId)
          .then(() => {
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      } else {
        telegramClient
          .pinChatMessage(target, messageId)
          .then(() => {
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      }
    } else {
      reject(new Error('Telegram client is not ready!'));
    }
  });
}

function telegramUnpinMessage(group, messageId) {
  return new Promise((resolve, reject) => {
    const target = telegramTargetEntities[group];
    if (telegramClient !== null && target !== undefined) {
      if (options.asUser === true) {
        telegramClient
          .unpinMessage(target, messageId)
          .then(() => {
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      } else {
        telegramClient
          .unpinChatMessage(target, messageId)
          .then(() => {
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      }
    } else {
      reject(new Error('Telegram client is not ready!'));
    }
  });
}

function gracefulExit() {
  if (telegramClient !== null && options.asUser === true && telegramClient.connected === true) {
    telegramClient
      .disconnect()
      .then(() => {
        log.info(`Telegram client is disconnected!`);
        telegramClient
          .destroy()
          .then(() => {
            log.info(`Telegram client is destroyed!`);
            telegramClient = null;
            exit(0);
          })
          .catch((error) => {
            log.error(`Telegram client - nothing to destroy!`);
            exit(0);
          });
      })
      .catch((error) => {
        log.error(`Telegram client is not connected!`);
        exit(0);
      });
  } else if (telegramClient !== null && options.user === false) {
    try {
      telegramClient.stop();
      log.info(`Telegram bot is stopped!`);
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (error) {
      log.info(`Telegram bot is stopped!`);
    }
    exit(0);
  } else {
    log.info('All clients are disconnected!');
    exit(0);
  }
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);


// Check for updates every 5 minutes
setInterval(checkForUpdates, options.scheduleUpdateInterval * 60 * 1000);

(async () => {
  try {
    telegramClient = await getTelegramClient();
    for (const group of groups) {
      await getTelegramTargetEntity(group);
    }
    // Initial check
    await checkForUpdates();
  } catch (error) {
    log.error(`Error: ${error}`);
    gracefulExit();
  }
})();