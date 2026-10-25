const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Settings, normalizeGroupId, parseAdminIds, parseChannelIds, normalizeTarget, targetKey, parseTargetRef} = require('../src/modules/config/settings');

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

  test('normalizeTarget infers type, validates ids and builds keys', () => {
    expect(normalizeTarget({chatId: '-100', topicId: '7'})).toEqual({type: 'topic', chatId: -100, topicId: 7, label: null, enabled: true});
    expect(normalizeTarget({chatId: 42})).toEqual({type: 'user', chatId: 42, topicId: null, label: null, enabled: true});
    expect(normalizeTarget({chatId: -5, topicId: 0, label: '  Main  ', enabled: false})).toEqual({type: 'group', chatId: -5, topicId: null, label: 'Main', enabled: false});
    expect(normalizeTarget({type: 'Channel', chatId: -100})).toMatchObject({type: 'channel'});
    expect(() => normalizeTarget({chatId: 0})).toThrow(/non-zero/);
    expect(() => normalizeTarget({chatId: -1, topicId: -2})).toThrow(/non-negative/);
    expect(() => normalizeTarget({type: 'topic', chatId: -1})).toThrow(/topic id/);
    expect(() => normalizeTarget({type: 'nope', chatId: -1})).toThrow(/Unknown target type/);
    expect(targetKey({chatId: -100, topicId: null})).toBe('-100:0');
    expect(targetKey({chatId: -100, topicId: 7})).toBe('-100:7');
  });

  test('parseTargetRef accepts chatId with optional topic', () => {
    expect(parseTargetRef('-1001/12')).toEqual({chatId: -1001, topicId: 12});
    expect(parseTargetRef(' 555 ')).toEqual({chatId: 555, topicId: null});
    expect(parseTargetRef('-1:0')).toEqual({chatId: -1, topicId: null});
    expect(parseTargetRef('abc')).toBeNull();
    expect(parseTargetRef('-1/x')).toBeNull();
  });
});

describe('Settings groups', () => {
  test('setGroupField validates and coerces, configuredGroupIds needs a calendar', () => {
    const settings = makeSettings();
    expect(settings.configuredGroupIds()).toEqual([]);
    settings.addTargetToGroup('2_1', {chatId: '-1001'});
    expect(settings.configuredGroupIds()).toEqual([]);
    expect(settings.knownGroupIds()).toEqual(['2.1']);
    settings.setGroupField('2.1', 'calendarId', ' cal@group ');
    settings.setGroupField('1.2', 'calendarId', 'cal2');
    settings.setGroupField('2.1', 'svitlobotChannelIds', 'a,b');
    settings.setGroupField('10.1', 'calendarId', 'cal10');
    expect(settings.configuredGroupIds()).toEqual(['1.2', '2.1', '10.1']);
    expect(settings.getGroup('2.1')).toEqual({calendarId: 'cal@group', targetKeys: ['-1001:0'], svitlobotChannelIds: ['a', 'b']});
    expect(settings.listTargets('2.1')).toEqual([{type: 'group', chatId: -1001, topicId: null, label: null, enabled: true, key: '-1001:0'}]);
    expect(() => settings.setGroupField('x.y', 'calendarId', 'x')).toThrow(/Invalid group id/);
    expect(() => settings.setGroupField('2.1', 'nope', 'x')).toThrow(/Unknown group field/);
  });

  test('unsetGroupField removes the record when nothing is left', () => {
    const settings = makeSettings();
    settings.setGroupField('1.1', 'calendarId', 'cal');
    settings.setGroupField('1.1', 'svitlobotChannelIds', 'k');
    settings.unsetGroupField('1.1', 'calendarId');
    expect(settings.knownGroupIds()).toEqual(['1.1']);
    settings.unsetGroupField('1.1', 'svitlobotChannelIds');
    expect(settings.knownGroupIds()).toEqual([]);
  });

  test('targets are global: add, assign to several groups, update, unassign, remove', () => {
    const settings = makeSettings();
    const first = settings.addTarget({chatId: -100, topicId: 2, label: 'Main'});
    expect(first.key).toBe('-100:2');
    settings.addTarget({type: 'channel', chatId: -200});
    expect(() => settings.addTarget({chatId: '-100', topicId: '2'})).toThrow(/already exists/);
    expect(settings.listAllTargets().map((target) => target.key)).toEqual(['-200:0', '-100:2']);

    settings.assignTarget('1.1', '-100:2');
    settings.assignTarget('1.1', '-100:2'); // idempotent
    settings.assignTarget('2.1', '-100:2');
    settings.assignTarget('2.1', '-200:0');
    expect(() => settings.assignTarget('3.1', '-1:0')).toThrow(/not found/);
    expect(settings.groupsUsingTarget('-100:2')).toEqual(['1.1', '2.1']);
    expect(settings.listTargets('2.1').map((target) => target.key)).toEqual(['-100:2', '-200:0']);
    expect(settings.getGroup('1.1').targetKeys).toEqual(['-100:2']);

    // addTargetToGroup reuses an existing target and fills a missing label
    const reused = settings.addTargetToGroup('3.1', {chatId: -200, label: 'News'});
    expect(reused).toMatchObject({key: '-200:0', label: 'News'});
    expect(settings.listAllTargets()).toHaveLength(2);
    expect(settings.groupsUsingTarget('-200:0')).toEqual(['2.1', '3.1']);

    settings.setLastMessageId('1.1', '-100:2', 77);
    settings.setLastMessageId('2.1', '-100:2', 78);
    const updated = settings.updateTarget('-100:2', {enabled: false, label: 'Paused', chatId: -999});
    expect(updated).toEqual({type: 'topic', chatId: -100, topicId: 2, label: 'Paused', enabled: false, key: '-100:2'});
    expect(() => settings.updateTarget('-1:0', {enabled: true})).toThrow(/not found/);

    settings.unassignTarget('1.1', '-100:2');
    expect(settings.getLastMessageId('1.1', '-100:2')).toBeNull();
    expect(settings.getLastMessageId('2.1', '-100:2')).toBe(78);
    expect(settings.knownGroupIds()).toEqual(['2.1', '3.1']); // 1.1 had nothing else
    expect(() => settings.unassignTarget('1.1', '-100:2')).toThrow(/not assigned/);

    expect(settings.removeTarget('-100:2')).toEqual(['2.1']);
    expect(settings.getTarget('-100:2')).toBeNull();
    expect(settings.getLastMessageId('2.1', '-100:2')).toBeNull();
    expect(settings.listTargets('2.1').map((target) => target.key)).toEqual(['-200:0']);
    expect(() => settings.removeTarget('-100:2')).toThrow(/not found/);
  });

  test('a v1 document is migrated through v2 to global targets on init', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'config.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        groups: {
          '1.1': {calendarId: 'cal', telegramChatId: -100, telegramTopicId: 2, svitlobotChannelIds: []},
          '2.1': {calendarId: 'cal2', telegramChatId: null, telegramTopicId: null, svitlobotChannelIds: []},
        },
        state: {lastMessageIds: {'1.1': 614}, knownYasnoStatuses: {}},
      }),
    );
    const settings = new Settings({filePath});
    settings.init();
    expect(settings.store.get('version')).toBe(3);
    expect(settings.getGroup('1.1')).toEqual({calendarId: 'cal', targetKeys: ['-100:2'], svitlobotChannelIds: []});
    expect(settings.listAllTargets()).toEqual([{type: 'topic', chatId: -100, topicId: 2, label: null, enabled: true, key: '-100:2'}]);
    expect(settings.getGroup('2.1').targetKeys).toEqual([]);
    expect(settings.getLastMessageId('1.1', '-100:2')).toBe(614);
    expect(settings.store.get(['groups', '1.1', 'telegramChatId'], 'gone')).toBe('gone');
    expect(settings.store.get(['groups', '1.1', 'telegramTargets'], 'gone')).toBe('gone');
    expect(settings.store.get(['state', 'lastMessageIds', '1.1'], 'gone')).toBe('gone');
  });

  test('a v2 document shares identical targets between groups when upgraded', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'config.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 2,
        groups: {
          '1.1': {calendarId: 'cal', telegramTargets: [{type: 'topic', chatId: -100, topicId: 2, label: 'Main', enabled: false}], svitlobotChannelIds: []},
          '2.1': {calendarId: 'cal2', telegramTargets: [{type: 'topic', chatId: -100, topicId: 2, label: null, enabled: true}, {type: 'channel', chatId: -300, topicId: null, label: null, enabled: true}], svitlobotChannelIds: []},
        },
        state: {lastMessageIds: {'1.1|-100:2': 1, '2.1|-100:2': 2}, knownYasnoStatuses: {}},
      }),
    );
    const settings = new Settings({filePath});
    settings.init();
    expect(settings.store.get('version')).toBe(3);
    expect(settings.listAllTargets().map((target) => target.key)).toEqual(['-300:0', '-100:2']);
    expect(settings.getTarget('-100:2')).toMatchObject({label: 'Main', enabled: true});
    expect(settings.groupsUsingTarget('-100:2')).toEqual(['1.1', '2.1']);
    expect(settings.getLastMessageId('2.1', '-100:2')).toBe(2);
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
      TELEGRAM_CHAT_ID_GROUP_1_1: '-100, -200/5',
      TELEGRAM_TOPIC_ID_GROUP_1_1: '7',
      SVITLOBOT_CHANNEL_ID_GROUP_1__1: 'KEY1',
      CALENDAR_ID_GROUP_2: 'cal21',
      TELEGRAM_CHAT_ID_GROUP_2_1: 'nonsense',
      CALENDAR_ID_GROUP_X: 'ignored',
    });
    expect(applied.sort()).toEqual(
      ['TELEGRAM_BOT_AUTH_TOKEN', 'TELEGRAM_ADMIN_IDS', 'CALENDAR_ID_GROUP_1_1', 'TELEGRAM_CHAT_ID_GROUP_1_1', 'SVITLOBOT_CHANNEL_ID_GROUP_1__1', 'CALENDAR_ID_GROUP_2'].sort(),
    );
    expect(settings.getGroup('1.1')).toEqual({calendarId: 'cal11', targetKeys: ['-100:7', '-200:5'], svitlobotChannelIds: ['KEY1']});
    expect(settings.listTargets('1.1')).toEqual([
      {type: 'topic', chatId: -100, topicId: 7, label: null, enabled: true, key: '-100:7'},
      {type: 'topic', chatId: -200, topicId: 5, label: null, enabled: true, key: '-200:5'},
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_CHAT_ID_GROUP_2_1'));
    expect(settings.getGroup('2.1').calendarId).toBe('cal21');
    expect(settings.getAdminIds()).toEqual([10, 20]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CALENDAR_ID_GROUP_X'));

    settings.setGroupField('1.1', 'calendarId', 'changed-via-bot');
    warn.mockClear();
    const appliedAgain = settings.seedFromEnv({CALENDAR_ID_GROUP_1_1: 'cal11', TELEGRAM_CHAT_ID_GROUP_1_1: '-100/7,-200/5'});
    expect(appliedAgain).toEqual([]);
    expect(settings.getGroup('1.1').calendarId).toBe('changed-via-bot');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CALENDAR_ID_GROUP_1_1'));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('Settings env quoting', () => {
  test('values quoted as docker --env-file passes them are accepted', () => {
    const warn = jest.fn();
    const settings = new Settings({filePath: path.join(tmpDir(), 'config.json'), logger: {warn}});
    settings.init();
    const token = '1234567890:' + 'D'.repeat(35);
    settings.seedFromEnv({
      TELEGRAM_ADMIN_IDS: '"5442917158, 42"',
      TELEGRAM_BOT_AUTH_TOKEN: `'${token}'`,
      CALENDAR_ID_GROUP_1_1: '"cal@group"',
      TELEGRAM_CHAT_ID_GROUP_1_1: '"-100/2"',
    });
    expect(settings.getAdminIds()).toEqual([5442917158, 42]);
    expect(settings.getBotToken()).toBe(token);
    expect(settings.getGroup('1.1')).toMatchObject({calendarId: 'cal@group', targetKeys: ['-100:2']});
    expect(warn).not.toHaveBeenCalled();
    settings.setAdminIds([]);
    settings.seedFromEnv({TELEGRAM_ADMIN_IDS: 'me'});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no valid Telegram user ids'));
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
    expect(settings.getGroup('1.1')).toEqual({calendarId: 'cal11', targetKeys: ['-100500:2'], svitlobotChannelIds: ['K1', 'K2']});
    expect(settings.getTarget('-100500:2')).toMatchObject({type: 'topic', chatId: -100500, topicId: 2});
    expect(settings.getGroup('2.1').calendarId).toBe('cal21');
    expect(settings.getLastMessageId('1.1', '-100500:2')).toBe(578);
    expect(settings.store.get('version')).toBe(3);
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
