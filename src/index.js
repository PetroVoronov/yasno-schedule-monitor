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

const {google} = require('googleapis');

// i18n.setLocale(options.language);

const groups = [1];

const storage = new LocalStorage('data/storage');
const cache = new Cache({
  getItem: (key) => storage.getItem(key),
  setItem: (key, value) => storage.setItem(key, value),
  removeItem: (key) => storage.removeItem(key),
});

const groupsSchedule = cache.getItem('groupsSchedule') || {};

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

async function checkForUpdates() {
  try {
    const response = await axios.get(yasnoApiUrl);
    const data = response.data;

    // Find the relevant component
    const component = data.components.find(comp => comp.template_name === 'electricity-outages-daily-schedule');
    if (!component) {
      log.error('Relevant component not found in the JSON data.');
      return;
    }

    const kievData = component.dailySchedule.kiev.today;
    const lastRegistryUpdateTime = component.lastRegistryUpdateTime;

    const currentData = {
      kievData,
      lastRegistryUpdateTime
    };

    if (previousData &&
      (JSON.stringify(previousData.kievData) !== JSON.stringify(currentData.kievData) ||
        previousData.lastRegistryUpdateTime !== currentData.lastRegistryUpdateTime)) {
      log.warn('Schedule or registry update time has changed.');
    }

    previousData = currentData;

    // Process the kievData to create intervals of hours with DEFINITE_OUTAGE
    const intervals = createOutageIntervals(kievData.groups);

    await processScheduleUpdate(intervals, lastRegistryUpdateTime);

    log.info('Outage intervals:', stringify(intervals));
  } catch (error) {
    log.error('Error fetching or processing data:', error);
  }
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


async function processScheduleUpdate(intervals, registryUpdateTime) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  for (const group of groups) {
    groupsSchedule[group] = groupsSchedule[group] || {};
    const schedule = groupsSchedule[group];
    if (schedule && schedule.today) {
      if (schedule.today.toISOString().slice(0, 10) !== todayStr) {
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
        log.info(`Schedule for group ${group} has been updated to:`, stringify(intervals[group]));
        await calendarUpdate(group, today);
      }
    }
  };

  // cache.setItem('groupsSchedule', groupsSchedule);
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


async function getCalendarEvents(auth, group, today) {
  try {
    const calendar = google.calendar('v3');
    const timeZone = 'Europe/Kiev'; // Replace with your desired time zone
    const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();
    const response = await calendar.events.list({
      auth: auth,
      calendarId: cache.getItem(`group${group}CalendarId`),
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

async function calendarUpdate(group, today) {
  const auth = await authenticateToCalendar(await readPrivateKey());

  const events = await getCalendarEvents(auth, group, today);
  log.info('Events:', stringify(events));
}

// Check for updates every 5 minutes
// setInterval(checkForUpdates, /* 5 * 60 */ 30 * 1000);

// Initial check
checkForUpdates();