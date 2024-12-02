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


const url = 'https://api.yasno.com.ua/api/v1/pages/home/schedule-turn-off-electricity';
let previousData = null;

async function checkForUpdates() {
    try {
        const response = await axios.get(url);
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

        log.info('Outage intervals:', intervals);
    } catch (error) {
        log.error('Error fetching or processing data:', error);
    }
}

function createOutageIntervals(kievData) {
    const intervals = [];

    for (const group of Object.keys(kievData)) {
        const hours = kievData[group];
        let interval = null;

        for (const hour of hours) {
            if (hour.type === 'DEFINITE_OUTAGE') {
                if (!interval) {
                    interval = { start: hour.start, end: hour.end };
                } else if (hour.start === interval.end) {
                    interval.end = hour.end;
                } else {
                    intervals.push(`Group ${group}: ${interval.start} - ${interval.end}`);
                    interval = { start: hour.start, end: hour.end };
                }
            } else if (interval) {
                intervals.push(`Group ${group}: ${interval.start} - ${interval.end}`);
                interval = null;
            }
        }

        if (interval) {
            intervals.push(`Group ${group}: ${interval.start} - ${interval.end}`);
        }
    }

    return intervals;
}

// Check for updates every 5 minutes
setInterval(checkForUpdates, /* 5 * 60 */ 30 * 1000);

// Initial check
checkForUpdates();