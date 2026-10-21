const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Settings, normalizeGroupId, parseAdminIds, parseChannelIds} = require('../src/modules/config/settings');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-settings-'));
}

function makeSettings(dir = tmpDir()) {
  const settings = new Settings({filePath: path.join(dir, 'config.json')});
  settings.init();
  return settings;
}

describe('helpers', () => {
  test('normalizeGroupId accepts the supported spellings', () => {
    expect(normalizeGroupId('1.1')).toBe('1.1');
    expect(normalizeGroupId('1_2')).toBe('1.2');
    expect(normalizeGroupId('6-2')).toBe('6.2');
    expect(normalizeGroupId('3')).toBe('3.1');
    expect(normalizeGroupId('60')).toBe('60.1');
    expect(normalizeGroupId('07.01')).toBe('7.1');
    expect(normalizeGroupId('1.3')).toBe('1.3');
    expect(normalizeGroupId('0.1')).toBeNull();
    expect(normalizeGroupId('1._1')).toBeNull();
    expect(normalizeGroupId('1.1.1')).toBeNull();
    expect(normalizeGroupId('abc')).toBeNull();
    expect(normalizeGroupId('')).toBeNull();
  });

  test('parseAdminIds and parseChannelIds normalise lists', () => {
    expect(parseAdminIds('1, 2;3 2 x -4')).toEqual([1, 2, 3]);
    expect(parseAdminIds([5, '6'])).toEqual([5, 6]);
    expect(parseChannelIds(' A ,B,,A')).toEqual(['A', 'B']);
  });
});

describe('Settings groups', () => {
  test('setGroupField validates and coerces, configuredGroupIds needs a calendar', () => {
    const settings = makeSettings();
    expect(settings.configuredGroupIds()).toEqual([]);
    settings.setGroupField('2_1', 'telegramChatId', '-1001');
    expect(settings.configuredGroupIds()).toEqual([]);
    expect(settings.knownGroupIds()).toEqual(['2.1']);
    settings.setGroupField('2.1', 'calendarId', ' cal@group ');
    settings.setGroupField('1.2', 'calendarId', 'cal2');
    settings.setGroupField('2.1', 'svitlobotChannelIds', 'a,b');
    settings.setGroupField('10.1', 'calendarId', 'cal10');
    expect(settings.configuredGroupIds()).toEqual(['1.2', '2.1', '10.1']);
    expect(settings.getGroup('2.1')).toEqual({calendarId: 'cal@group', telegramChatId: -1001, telegramTopicId: null, svitlobotChannelIds: ['a', 'b']});
    expect(() => settings.setGroupField('2.1', 'telegramChatId', 'abc')).toThrow(/integer/);
    expect(() => settings.setGroupField('x.y', 'calendarId', 'x')).toThrow(/Invalid group id/);
    expect(() => settings.setGroupField('2.1', 'nope', 'x')).toThrow(/Unknown group field/);
  });

  test('unsetGroupField removes the record when nothing is left', () => {
    const settings = makeSettings();
    settings.setGroupField('1.1', 'calendarId', 'cal');
    settings.setGroupField('1.1', 'telegramTopicId', 5);
    settings.unsetGroupField('1.1', 'calendarId');
    expect(settings.knownGroupIds()).toEqual(['1.1']);
    settings.unsetGroupField('1.1', 'telegramTopicId');
    expect(settings.knownGroupIds()).toEqual([]);
  });
});

describe('Settings Yasno group list', () => {
  test('group ids from Yasno are stored once and validate new groups', () => {
    const settings = makeSettings();
    expect(settings.getYasnoGroupIds()).toEqual([]);
    settings.setGroupField('99.1', 'calendarId', 'accepted-before-list-is-known');
    expect(settings.setYasnoGroupIds(['2.1', '10.1', '1.1', '1.1', 'bad'])).toBe(true);
    expect(settings.getYasnoGroupIds()).toEqual(['1.1', '2.1', '10.1']);
    expect(settings.setYasnoGroupIds(['10.1', '1.1', '2.1'])).toBe(false);
    expect(settings.setYasnoGroupIds([])).toBe(false);
    expect(() => settings.setGroupField('3.1', 'calendarId', 'x')).toThrow(/Unknown Yasno group 3.1/);
    settings.setGroupField('10', 'calendarId', 'cal10');
    expect(settings.getGroup('10.1').calendarId).toBe('cal10');
    // Groups that disappeared from Yasno can still be cleaned up.
    settings.unsetGroupField('99.1', 'calendarId');
    settings.removeGroup('99.1');
    expect(settings.knownGroupIds()).toEqual(['10.1']);
  });
});

describe('Settings options and telegram', () => {
  test('options persist only for the allowed names', () => {
    const settings = makeSettings();
    expect(settings.getOption('pinMessage')).toBeNull();
    settings.setOption('pinMessage', true);
    expect(settings.getOption('pinMessage')).toBe(true);
    expect(() => settings.setOption('language', 'en')).toThrow(/cannot be persisted/);
  });

  test('bot token must be long enough, admin ids are deduplicated', () => {
    const settings = makeSettings();
    settings.setBotToken('short');
    expect(settings.getBotToken()).toBeNull();
    const token = '1234567890:' + 'A'.repeat(35);
    settings.setBotToken(token);
    expect(settings.getBotToken()).toBe(token);
    settings.setAdminIds('1,1,2');
    expect(settings.getAdminIds()).toEqual([1, 2]);
  });
});

describe('Settings env seeding', () => {
  test('env seeds empty fields, stored values win afterwards', () => {
    const warn = jest.fn();
    const dir = tmpDir();
    const settings = new Settings({filePath: path.join(dir, 'config.json'), logger: {warn}});
    settings.init();
    const token = '1234567890:' + 'B'.repeat(35);
    const applied = settings.seedFromEnv({
      TELEGRAM_BOT_AUTH_TOKEN: token,
      TELEGRAM_ADMIN_IDS: '10, 20',
      CALENDAR_ID_GROUP_1_1: 'cal11',
      TELEGRAM_CHAT_ID_GROUP_1_1: '-100',
      TELEGRAM_TOPIC_ID_GROUP_1_1: '7',
      SVITLOBOT_CHANNEL_ID_GROUP_1__1: 'KEY1',
      CALENDAR_ID_GROUP_2: 'cal21',
      CALENDAR_ID_GROUP_X: 'ignored',
    });
    expect(applied.sort()).toEqual(
      ['TELEGRAM_BOT_AUTH_TOKEN', 'TELEGRAM_ADMIN_IDS', 'CALENDAR_ID_GROUP_1_1', 'TELEGRAM_CHAT_ID_GROUP_1_1', 'TELEGRAM_TOPIC_ID_GROUP_1_1', 'SVITLOBOT_CHANNEL_ID_GROUP_1__1', 'CALENDAR_ID_GROUP_2'].sort(),
    );
    expect(settings.getGroup('1.1')).toEqual({calendarId: 'cal11', telegramChatId: -100, telegramTopicId: 7, svitlobotChannelIds: ['KEY1']});
    expect(settings.getGroup('2.1').calendarId).toBe('cal21');
    expect(settings.getAdminIds()).toEqual([10, 20]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CALENDAR_ID_GROUP_X'));

    settings.setGroupField('1.1', 'calendarId', 'changed-via-bot');
    warn.mockClear();
    const appliedAgain = settings.seedFromEnv({CALENDAR_ID_GROUP_1_1: 'cal11', TELEGRAM_CHAT_ID_GROUP_1_1: '-100'});
    expect(appliedAgain).toEqual([]);
    expect(settings.getGroup('1.1').calendarId).toBe('changed-via-bot');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CALENDAR_ID_GROUP_1_1'));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('Settings legacy import', () => {
  test('imports node-localstorage files once and leaves them in place', () => {
    const dir = tmpDir();
    const legacyDir = path.join(dir, 'storage');
    fs.mkdirSync(legacyDir);
    const token = '1234567890:' + 'C'.repeat(35);
    const files = {
      'calendarIdGroup1.1': JSON.stringify('cal11'),
      calendarIdGroup2: JSON.stringify('cal21'),
      'telegramChatIdGroup1.1': '-100500',
      'telegramTopicIdGroup1.1': '2',
      'svitlobotChannelIdGroup1.1': JSON.stringify('K1, K2'),
      'svitlobotChannelIdGroup1._1': JSON.stringify('BROKEN'),
      lastMessageIdGroup1: '487',
      'lastMessageIdGroup1.1': '578',
      telegramBotAuthToken: JSON.stringify(token),
      knownYasnoStatuses: JSON.stringify({ScheduleApplies: {status: 'ScheduleApplies'}}),
      unknownKey: '"x"',
    };
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(legacyDir, name), content);
    }
    const settings = new Settings({filePath: path.join(dir, 'config.json')});
    const result = settings.init({legacyDir});
    expect(result.loaded).toBe(false);
    expect(result.imported).toBe(9);
    expect(settings.getGroup('1.1')).toEqual({calendarId: 'cal11', telegramChatId: -100500, telegramTopicId: 2, svitlobotChannelIds: ['K1', 'K2']});
    expect(settings.getGroup('2.1').calendarId).toBe('cal21');
    expect(settings.getLastMessageId('1.1')).toBe(578);
    expect(settings.getBotToken()).toBe(token);
    expect(Object.keys(settings.getKnownYasnoStatuses())).toEqual(['ScheduleApplies']);
    expect(fs.readdirSync(legacyDir)).toHaveLength(Object.keys(files).length);

    // Second start: config exists, legacy is not imported again even if files changed.
    fs.writeFileSync(path.join(legacyDir, 'calendarIdGroup1.1'), JSON.stringify('other'));
    const again = new Settings({filePath: path.join(dir, 'config.json')});
    const secondResult = again.init({legacyDir});
    expect(secondResult.loaded).toBe(true);
    expect(secondResult.imported).toBe(0);
    expect(again.getGroup('1.1').calendarId).toBe('cal11');
  });
});
