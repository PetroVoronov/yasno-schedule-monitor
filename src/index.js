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
const { toZonedTime, format: formatTz } = require('date-fns-tz');
const template = require('string-template');
const { google } = require('googleapis');
const { url } = require('node:inspector');

// i18n.setLocale(options.language);

const options = yargs
  .usage('Usage: $0 [options]')
  .option('as-user', {
    describe: 'Start as user instance (bot instance by default)',
    type: 'boolean',
    default: false,
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
  .option('l', {
    alias: 'language',
    describe: 'Language code for i18n',
    type: 'string',
    default: 'uk',
    demandOption: false,
  })
  .option('d', {
    alias: 'debug',
    describe: 'Debug level of logging',
    type: 'boolean',
    demandOption: false,
  })
  .version(scriptVersion)
  .help('h')
  .alias('h', 'help')
  .epilog(`${scriptName} v${scriptVersion}`).argv;

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
const groupsSchedule = {};

log.appendMaskWord(...groups.map((group) => `calendarIdGroup${group}`));



const yasnoApiUrl = 'https://api.yasno.com.ua/api/v1/pages/home/schedule-turn-off-electricity';
const yasnoMainUrl = 'https://yasno.com.ua';
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

let textTelegramMessageHeader = '';


const timeZone = 'Europe/Kiev'; // Replace with your desired time zone

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

      // Process the kievData to create intervals of hours with DEFINITE_OUTAGE
      const intervals = createOutageIntervals(currentData.kyivData.groups);

      await processScheduleUpdate(intervals, targetDate, currentData.lastRegistryUpdateTime);

      previousData = currentData;


    } else {
      log.info('No changes in the schedule or registry update time.');
    }
  }
}

function parseScheduleTargetDate(dateString) {
  // Define the format of the input date string
  const formatString = " dd.MM.yyyy 'на' HH:mm";

  // Parse the date string using the specified format and locale
  const result = parseDate(dateString.split(',').pop(), formatString, new Date(), { locale: 'uk' });
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
  const date = toZonedTime(new Date(), timeZone);
  const halfHour = hour % 1;
  if (halfHour === 0) {
    return formatTz(date.setHours(hour, min, sec, ms), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone });
  }
  else {
    const nextHour = Math.floor(hour);
    const nextMin = halfHour * 60;
    return formatTz(date.setHours(nextHour, nextMin, sec, ms), "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone });
  }
}

async function processScheduleUpdate(intervals, today, registryUpdateTime) {
  const todayStr = dateToString(today);
  const now = toZonedTime(new Date(), timeZone);
  const textForData = today.getDay() === now.getDay() ? textToday : textTomorrow;
  const scheduleUpdate = Math.floor(today.getTime() / 1000);
  textTelegramMessageHeader = template(textScheduleUpdated, { today: textForData, date: todayStr });
  for (const group of groups) {
    if (!groupsSchedule[group]) {
      groupsSchedule[group] = {};
    }
    const schedule = groupsSchedule[group];
    if (schedule && schedule.today) {
      if (dateToString(schedule.today) !== todayStr) {
        schedule.today = today;
        schedule.schedule = [];
        schedule.updated = scheduleUpdate;
      }
    } else {
      schedule.today = today;
      schedule.schedule = [];
      schedule.updated = scheduleUpdate;
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


function prepareCalendarEvent(group, today, interval) {
  const timestamp = formatTz(today, "dd.MM.yyyy HH:mm", { timeZone });
  return {
    summary: template(calendarEventSummary, { group }),
    description: template(calendarEventDescription, { timestamp, url: yasnoMainUrl }),
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
    events.push(prepareCalendarEvent(group, today, interval));
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


async function telegramSendUpdate(group, groupEvents) {
  let message = textTelegramMessageHeader + ':';
  if (groupEvents.length === 0) {
    message += `\n${i18n.__('no outages!')}`;
  } else {
    groupEvents.forEach((event) => {
      message += `\n${template(textScheduleOutageDefiniteLine, { start: event.start.dateTime.slice(11, 16), end: event.end.dateTime.slice(11, 16) })
        }`;
    });
  }
  const targetTitle = telegramTargetTitles[group];
  if (targetTitle !== undefined) {
    telegramSendMessage(group, message).then((messageId) => {
      const cacheIdLastMessageId = `lastMessageIdGroup${group}`;
      const previousMessageId = cache.getItem(cacheIdLastMessageId, 'number');
      cache.setItem(cacheIdLastMessageId, messageId);
      if (options.pinMessage) {
        telegramPinMessage(group, messageId)
          .then(() => {
            log.debug(`Telegram message with id: ${messageId} pinned to "${targetTitle}" with topic ${telegramTopicId}`);
            if (options.unpinPrevious) {
              if (previousMessageId !== undefined && previousMessageId !== null) {
                telegramUnpinMessage(group, previousMessageId)
                  .then(() => {
                    log.debug(
                      `Telegram message with id: ${previousMessageId} unpinned from "${targetTitle}" with topic ${telegramTopicId}`,
                    );
                  })
                  .catch((error) => {
                    log.error(`Telegram message unpin error: ${error}`);
                  });
              }
            }
          })
          .catch((error) => {
            log.error(`Telegram message pin error: ${error}`);
          });
      }
    })
      .catch((error) => {
        log.error(`Telegram message error: ${error}`);
      });
  } else {
    log.debug(`Telegram is not configured for group ${group}`);
  }
}

async function calendarUpdate(group, today) {
  const groupSchedule = groupsSchedule[group];
  const eventsNew = prepareCalendarEvents(group, today, groupSchedule.schedule);
  log.debug('Events new:', stringify(eventsNew));
  const auth = await authenticateToCalendar(await readPrivateKey());
  const calendar = google.calendar('v3');
  const calendarId = cache.getItem(`calendarIdGroup${group}`);
  const events = await getCalendarEvents(calendar, auth, calendarId, today);
  log.debug('Events:', stringify(events));
  const { eventsToDelete, eventsToAdd } = compareCalendarEvents(events, eventsNew);
  log.debug('Events to delete:', stringify(eventsToDelete));
  log.debug('Events to add:', stringify(eventsToAdd));
  await calendarEventsDelete(calendar, auth, calendarId, eventsToDelete);
  await calendarEventsAdd(calendar, auth, calendarId, eventsToAdd);
  if (eventsToDelete.length > 0 || eventsToAdd.length > 0) {
    await telegramSendUpdate(group, eventsNew);
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
          log.debug(`Telegram message sent to "${telegramTargetTitle}" with topic ${telegramTopicId}`);
          resolve(options.asUser === true ? message.id : message.message_id);
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