const { Api, TelegramClient } = require('telegram');
const { Api: GrammyApi } = require('grammy');
const { StringSession, StoreSession } = require('telegram/sessions');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output, exit } = require('node:process');
const stringify = require('json-stringify-safe');
const { LocalStorage } = require('node-localstorage');
const yargs = require('yargs');
const { Cache } = require('./modules/cache/Cache');
const { securedLogger: log } = require('./modules/logging/logging');
const { name: scriptName, version: scriptVersion } = require('./version');
const i18n = require('./modules/i18n/i18n.config');
const axios = require('axios');
const fs = require('node:fs');
const { parse: parseDate } = require('date-fns');
const { format: formatTz } = require('date-fns-tz');

const { google } = require('googleapis');

// i18n.setLocale(options.language);

const options = yargs
  .usage('Usage: $0 [options]')
  .option('d', {
    alias: 'debug',
    describe: 'Debug level of logging',
    type: 'boolean',
    demandOption: false,
  })
  .option('i', {
    alias: 'schedule-update-interval',
    describe: 'Update interval for schedule in minutes',
    type: 'number',
    default: 5,
    min: 1,
    max: 120,
    demandOption: false,
  })
  .version(scriptVersion)
  .help('h')
  .alias('h', 'help')
  .epilog(`${scriptName} v${scriptVersion}`).argv;

if (options.debug) {
  log.setLevel('debug');
}



log.info(`Starting ${scriptName} v${scriptVersion} ...`);
log.info(`Schedule update interval: ${options.scheduleUpdateInterval} minutes`);
log.info(`Debug: ${options.debug}`);

const groups = [1];
const groupsSchedule = {};

log.appendMaskWord(...groups.map((group) => `group${group}CalendarId`));


const storage = new LocalStorage('data/storage');
const cache = new Cache({
  getItem: (key) => storage.getItem(key),
  setItem: (key, value) => storage.setItem(key, value),
  removeItem: (key) => storage.removeItem(key),
});

groups.forEach((group) => {
  if (typeof process.env[`GROUP_${group}_CALENDAR_ID`] === 'string' && process.env[`GROUP_${group}_CALENDAR_ID`].length > 0) {
    cache.setItem(`group${group}CalendarId`, process.env[`GROUP_${group}_CALENDAR_ID`]);
  }
});



const yasnoApiUrl = 'https://api.yasno.com.ua/api/v1/pages/home/schedule-turn-off-electricity';
let previousData = null;

const keyFilePath = 'data/yasno-monitor.json'; // path to JSON with private key been downloaded from Google
const calendarScope = 'https://www.googleapis.com/auth/calendar'; // authorization scopes
const calendarEventsScope = 'https://www.googleapis.com/auth/calendar.events';


const timeZone = 'Europe/Kiev'; // Replace with your desired time zone

async function checkForUpdates() {
  let currentData = null;
  try {
    const response = await axios.get(yasnoApiUrl);
    const data = response.data;

    // Find the relevant component
    const component = data.components.find(comp => comp.template_name === 'electricity-outages-daily-schedule');
    if (!component) {
      log.error('Relevant component not found in the JSON data.');
      return;
    }

    const kyivData = component.dailySchedule.kiev.today;
    const lastRegistryUpdateTime = component.lastRegistryUpdateTime;

    currentData = {
      kyivData,
      lastRegistryUpdateTime
    };

  } catch (error) {
    log.error('Error fetching or processing data:', error);
  }
  if (!currentData) {
    log.error('No data fetched or processed.');
  } else {

    const targetDate = parseScheduleTargetDate(currentData.kyivData.title);
    log.debug(`Target date: ${targetDate}`);

    if (previousData === null ||
      (JSON.stringify(previousData?.kyivData) !== JSON.stringify(currentData.kyivData) ||
        previousData?.lastRegistryUpdateTime !== currentData.lastRegistryUpdateTime)) {
      log.info('Schedule or registry update time has changed.');

      previousData = currentData;

      // Process the kievData to create intervals of hours with DEFINITE_OUTAGE
      const intervals = createOutageIntervals(currentData.kyivData.groups);

      await processScheduleUpdate(intervals, targetDate, currentData.lastRegistryUpdateTime);

    } else {
      log.info('No changes in the schedule or registry update time.');
    }
  }
}

function parseScheduleTargetDate(dateString) {
  // Define the format of the input date string
  const formatString = " dd.MM.yyyy 'на' HH:mm";

  // Parse the date string using the specified format and locale
  const result =  parseDate(dateString.split(',').pop(), formatString, new Date(), { locale: 'uk' });
  return result;
}

function createOutageIntervals(kievData) {
  const intervals = {};

  for (const group of Object.keys(kievData)) {
    const hours = kievData[group];
    let interval = null;

    intervals[group] = [];

    for (const hour of hours) {
      if (hour.type === 'DEFINITE_OUTAGE') {
        if (!interval) {
          interval = { start: hour.start, end: hour.end };
        } else if (hour.start === interval.end) {
          interval.end = hour.end;
        } else {
          intervals[group].push(interval);
          interval = { start: hour.start, end: hour.end };
        }
      } else if (interval) {
        intervals[group].push(interval);
        interval = null;
      }
    }
    if (interval) {
      intervals[group].push(interval);
    }
  }

  return intervals;
}

function dateToString(date) {
  return date.toLocaleString('uk-UA', { timeZone: timeZone }).slice(0, 10);
}

function todaySetHour(today, hour, min = 0, sec = 0, ms = 0) {
  return formatTz(today.setHours(hour, min, sec, ms), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone });
}

async function processScheduleUpdate(intervals, today, registryUpdateTime) {
  const todayStr = dateToString(today);
  for (const group of groups) {
    if (!groupsSchedule[group]) {
      groupsSchedule[group] = {};
    }
    const schedule = groupsSchedule[group];
    if (schedule && schedule.today) {
      if (dateToString(schedule.today) !== todayStr) {
        schedule.today = today;
        schedule.schedule = [];
        schedule.updated = Math.floor(today.getTime() / 1000)
      }
    } else {
      schedule.today = today;
      schedule.schedule = [];
      schedule.updated = Math.floor(today.getTime() / 1000)
    }
    if (intervals[group]) {
      if (stringify(schedule.schedule) !== stringify(intervals[group])) {
        schedule.schedule = intervals[group];
        schedule.updated = registryUpdateTime;
        log.debug(`Schedule for group ${group} has been updated to:`, stringify(intervals[group]));
        await calendarUpdate(group, today);
      }
    }
  };
}

async function readPrivateKey() {
  const content = fs.readFileSync(keyFilePath);
  return JSON.parse(content.toString());
}

async function authenticateToCalendar(key) {
  const jwtClient = new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    [calendarScope, calendarEventsScope]
  );
  await jwtClient.authorize();
  return jwtClient;
}


async function getCalendarEvents(calendar, auth, calendarId, today) {
  try {
    const startOfDay = todaySetHour(today, 0, 0, 0, 0);
    const endOfDay = todaySetHour(today, 23, 59, 59, 999);
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


function prepareCalendarEvent(today, interval) {
  return {
    summary: 'Power outage',
    description: 'Power outage',
    start: {
      dateTime: todaySetHour(today, interval.start),
      timeZone: timeZone
    },
    end: {
      dateTime: todaySetHour(today, interval.end),
      timeZone: timeZone
    }
  }
}

function prepareCalendarEvents(group, today, intervals) {
  const events = [];
  for (const interval of intervals) {
    events.push(prepareCalendarEvent(today, interval));
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
        resource: event
      });
    } catch (error) {
      console.error('Error adding calendar event:', error);
      throw error;
    }
  }
}

async function calendarUpdate(group, today) {
  const auth = await authenticateToCalendar(await readPrivateKey());
  const calendar = google.calendar('v3');
  const calendarId = cache.getItem(`group${group}CalendarId`);
  const events = await getCalendarEvents(calendar, auth, calendarId, today);
  log.debug('Events:', stringify(events));
  const eventsNew = prepareCalendarEvents(group, today, groupsSchedule[group].schedule);
  log.debug('Events new:', stringify(eventsNew));
  const { eventsToDelete, eventsToAdd } = compareCalendarEvents(events, eventsNew);
  log.debug('Events to delete:', stringify(eventsToDelete));
  log.debug('Events to add:', stringify(eventsToAdd));
  await calendarEventsDelete(calendar, auth, calendarId, eventsToDelete);
  await calendarEventsAdd(calendar, auth, calendarId, eventsToAdd);
}

// Check for updates every 5 minutes
setInterval(checkForUpdates, options.scheduleUpdateInterval * 60 * 1000);

// Initial check
checkForUpdates();