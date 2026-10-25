const {escapeHtml, splitArgs, parseBoolean, resolveField, formatMinutes, formatDuration, createManagementBot} = require('../src/modules/management/management');

describe('management helpers', () => {
  test('escapeHtml escapes markup', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(escapeHtml(null)).toBe('');
  });

  test('splitArgs and parseBoolean', () => {
    expect(splitArgs('  1.1  set  calendar  x y ')).toEqual(['1.1', 'set', 'calendar', 'x', 'y']);
    expect(splitArgs(undefined)).toEqual([]);
    expect(parseBoolean('ON')).toBe(true);
    expect(parseBoolean('ні')).toBe(false);
    expect(parseBoolean('maybe')).toBeNull();
  });

  test('resolveField maps aliases', () => {
    expect(resolveField('calendar')).toBe('calendarId');
    expect(resolveField('Svitlobot')).toBe('svitlobotChannelIds');
    expect(resolveField('calendarId')).toBe('calendarId');
    expect(resolveField('chat')).toBeNull();
    expect(resolveField('nope')).toBeNull();
  });

  test('formatters', () => {
    expect(formatMinutes(90)).toBe('01:30');
    expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m');
    expect(formatDuration(2 * 86400 * 1000)).toBe('2d 0h 0m');
  });
});

/**
 * Minimal grammY-like bot double. Handlers are kept in registration order and dispatched like a
 * composer chain: commands by name, `on` handlers by event, with `next()` continuing the chain.
 */
function fakeBot() {
  const middlewares = [];
  const handlers = [];
  const api = {setMyCommands: jest.fn().mockResolvedValue(true), sendMessage: jest.fn().mockResolvedValue({})};
  const composer = (chatType) => ({
    command: (names, handler) => handlers.push({type: 'command', names: [].concat(names), chatType, handler}),
    on: (event, handler) => handlers.push({type: 'on', event, chatType, handler}),
  });
  const bot = {
    api,
    ...composer(null),
    use: (mw) => middlewares.push(mw),
    chatType: (type) => composer(type),
    catch: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    isRunning: () => true,
  };
  function matches(entry, update) {
    if (entry.chatType !== null && entry.chatType !== update.chat.type) {
      return false;
    }
    if (update.callbackData !== undefined) {
      return entry.type === 'on' && entry.event === 'callback_query:data';
    }
    if (entry.type === 'command') {
      return update.text.startsWith('/') && entry.names.includes(update.text.split(' ')[0].slice(1));
    }
    return entry.event === 'message' || (entry.event === 'message:text' && typeof update.text === 'string');
  }
  async function dispatch({text, callbackData, from, chat, threadId}) {
    const replies = [];
    const edits = [];
    const answers = [];
    const update = {text, callbackData, chat};
    const ctx = {
      from,
      chat,
      api,
      msg: {text, message_thread_id: threadId, is_topic_message: threadId !== undefined},
      callbackQuery: callbackData === undefined ? undefined : {data: callbackData},
      match: typeof text === 'string' ? text.split(' ').slice(1).join(' ') : undefined,
      reply: jest.fn(async (message, options) => {
        replies.push({message, options});
        return {};
      }),
      editMessageText: jest.fn(async (message, options) => {
        edits.push({message, options});
        return true;
      }),
      answerCallbackQuery: jest.fn(async (options) => {
        answers.push(options);
        return true;
      }),
    };
    let mwIndex = 0;
    let hIndex = 0;
    const runHandlers = async () => {
      while (hIndex < handlers.length) {
        const entry = handlers[hIndex++];
        if (matches(entry, update)) {
          await entry.handler(ctx, runHandlers);
          return;
        }
      }
    };
    const next = async () => {
      if (mwIndex < middlewares.length) {
        await middlewares[mwIndex++](ctx, next);
        return;
      }
      await runHandlers();
    };
    await next();
    return {replies, edits, answers};
  }
  return {bot, dispatch, api};
}

/** In-memory stand-in for the controller: global targets map + groups with target keys. */
function fakeController(overrides = {}) {
  const targets = new Map([
    ['-100:2', {type: 'topic', chatId: -100, topicId: 2, label: null, enabled: true, key: '-100:2', title: 'TestSome', chatType: 'group', error: null, resolved: true}],
    ['-300:0', {type: 'channel', chatId: -300, topicId: null, label: 'News', enabled: true, key: '-300:0', title: 'News channel', chatType: 'channel', error: null, resolved: true}],
  ]);
  const groups = [{id: '1.1', calendarId: 'cal', targetKeys: ['-100:2'], svitlobotChannelIds: []}];
  const options = {scheduleUpdateInterval: 5, pinMessage: false, unpinPrevious: false, ignoreStatus: false, debug: false};
  const withGroups = (target) => ({...target, groups: groups.filter((group) => group.targetKeys.includes(target.key)).map((group) => group.id)});
  const groupStatus = (group) => ({...group, telegramTargets: group.targetKeys.map((key) => targets.get(key)).filter(Boolean).map(withGroups)});
  const findGroup = (id) => groups.find((group) => group.id === id);
  return {
    getAdminIds: () => [1, 2],
    addAdmin: jest.fn(),
    removeAdmin: jest.fn(),
    getStatus: () => ({
      name: 'ysm',
      version: '1.0.0',
      mode: 'bot',
      language: 'en',
      options: {...options},
      groups: groups.map(groupStatus),
      startedAt: Date.now(),
      lastCheckAt: null,
      lastChangeAt: null,
      lastError: null,
      nextCheckAt: null,
      checkInProgress: false,
      storagePath: 'data/config.json',
    }),
    getGroup: (id) => groupStatus(findGroup(id) || {id, calendarId: null, targetKeys: [], svitlobotChannelIds: []}),
    getYasnoGroupIds: () => ['1.1', '1.2', '2.1', '60.1'],
    getTargets: () => [...targets.values()].map(withGroups),
    getTarget: (key) => (targets.has(key) ? withGroups(targets.get(key)) : null),
    addTarget: jest.fn(async (input, groupId = null) => {
      const key = `${input.chatId}:${input.topicId ?? 0}`;
      if (!targets.has(key)) {
        targets.set(key, {type: input.type ?? (input.topicId ? 'topic' : 'group'), chatId: input.chatId, topicId: input.topicId ?? null, label: input.label || null, enabled: true, key, title: null, chatType: null, error: null, resolved: true});
      }
      if (groupId) {
        const group = findGroup(groupId) || groups[groups.push({id: groupId, calendarId: null, targetKeys: [], svitlobotChannelIds: []}) - 1];
        if (!group.targetKeys.includes(key)) {
          group.targetKeys.push(key);
        }
      }
      return withGroups(targets.get(key));
    }),
    updateTarget: jest.fn(async (key, patch) => {
      Object.assign(targets.get(key), patch);
      return withGroups(targets.get(key));
    }),
    removeTarget: jest.fn(async (key) => {
      const affected = groups.filter((group) => group.targetKeys.includes(key)).map((group) => group.id);
      targets.delete(key);
      for (const group of groups) {
        group.targetKeys = group.targetKeys.filter((item) => item !== key);
      }
      return affected;
    }),
    assignTarget: jest.fn(async (groupId, key) => {
      const group = findGroup(groupId);
      if (!group.targetKeys.includes(key)) {
        group.targetKeys.push(key);
      }
      return groupStatus(group);
    }),
    unassignTarget: jest.fn(async (groupId, key) => {
      const group = findGroup(groupId);
      group.targetKeys = group.targetKeys.filter((item) => item !== key);
      return groupStatus(group);
    }),
    getSchedule: () => null,
    getKnownStatuses: () => ({}),
    forceCheck: jest.fn().mockResolvedValue({changed: true, skipped: false, error: null}),
    setGroupField: jest.fn(async (id, field, value) => ({id, calendarId: field === 'calendarId' ? value : 'cal', targetKeys: [], telegramTargets: [], svitlobotChannelIds: []})),
    unsetGroupField: jest.fn(),
    removeGroup: jest.fn(),
    listDialogs: jest.fn(async () => null),
    listTopics: jest.fn(async () => null),
    setOption: jest.fn(async (name, value) => {
      options[name] = value;
      return value;
    }),
    ...overrides,
  };
}

const i18n = {__: (key) => key};
const logger = {debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()};
const admin = {id: 1};
const privateChat = {id: 1, type: 'private'};
const groupChat = {id: -100, type: 'supergroup', title: 'Power group'};
const buttons = (keyboard) => keyboard.inline_keyboard.flat().map((button) => button.callback_data);

describe('management bot commands', () => {
  test('ignores non-admin users entirely', async () => {
    const {bot, dispatch} = fakeBot();
    createManagementBot({bot, controller: fakeController(), i18n, logger});
    const {replies} = await dispatch({text: '/status', from: {id: 999}, chat: privateChat});
    expect(replies).toHaveLength(0);
  });

  test('ignores management commands sent in a group even by an admin', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const {replies} = await dispatch({text: '/check', from: admin, chat: groupChat});
    expect(replies).toHaveLength(0);
    expect(controller.forceCheck).not.toHaveBeenCalled();
  });

  test('/whoami in a group answers privately and includes topic id', async () => {
    const {bot, dispatch, api} = fakeBot();
    createManagementBot({bot, controller: fakeController(), i18n, logger});
    const {replies} = await dispatch({text: '/whoami', from: admin, chat: groupChat, threadId: 42});
    expect(replies).toHaveLength(0);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const [target, text] = api.sendMessage.mock.calls[0];
    expect(target).toBe(1);
    expect(text).toContain('<code>-100</code>');
    expect(text).toContain('<code>42</code>');
  });

  test('/status and /check work in private chat', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const status = await dispatch({text: '/status', from: admin, chat: privateChat});
    expect(status.replies[0].message).toContain('ysm v1.0.0');
    expect(status.replies[0].options.parse_mode).toBe('HTML');
    const check = await dispatch({text: '/check', from: admin, chat: privateChat});
    expect(controller.forceCheck).toHaveBeenCalledTimes(1);
    expect(check.replies.at(-1).message).toContain('schedule changes processed');
  });

  test('/group set validates input and forwards to the controller', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const bad = await dispatch({text: '/group x.y set calendar x', from: admin, chat: privateChat});
    expect(bad.replies[0].message).toContain('Invalid group id');
    const usage = await dispatch({text: '/group 1.1 set nope x', from: admin, chat: privateChat});
    expect(usage.replies[0].message).toContain('Usage');
    const ok = await dispatch({text: '/group 1_2 set calendar abc@group.calendar.google.com', from: admin, chat: privateChat});
    expect(controller.setGroupField).toHaveBeenCalledWith('1.2', 'calendarId', 'abc@group.calendar.google.com');
    expect(ok.replies[0].message).toContain('abc@group.calendar.google.com');
  });

  test('/interval and boolean options', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    await dispatch({text: '/interval 500', from: admin, chat: privateChat});
    expect(controller.setOption).not.toHaveBeenCalled();
    await dispatch({text: '/interval 10', from: admin, chat: privateChat});
    expect(controller.setOption).toHaveBeenCalledWith('scheduleUpdateInterval', 10);
    await dispatch({text: '/pin on', from: admin, chat: privateChat});
    expect(controller.setOption).toHaveBeenCalledWith('pinMessage', true);
    const current = await dispatch({text: '/debug', from: admin, chat: privateChat});
    expect(current.replies[0].message).toContain('Current value');
  });

  test('/admin cannot remove yourself, start() registers commands with callback updates', async () => {
    const {bot, dispatch, api} = fakeBot();
    const controller = fakeController();
    const management = createManagementBot({bot, controller, i18n, logger});
    const self = await dispatch({text: '/admin remove 1', from: admin, chat: privateChat});
    expect(self.replies[0].message).toContain('cannot remove yourself');
    expect(controller.removeAdmin).not.toHaveBeenCalled();
    await dispatch({text: '/admin add 2', from: admin, chat: privateChat});
    expect(controller.addAdmin).toHaveBeenCalledWith(2);
    await management.start();
    expect(api.setMyCommands).toHaveBeenCalledTimes(1);
    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(bot.start.mock.calls[0][0].allowed_updates).toEqual(['message', 'callback_query']);
  });

  test('unknown text shows the menu', async () => {
    const {bot, dispatch} = fakeBot();
    createManagementBot({bot, controller: fakeController(), i18n, logger});
    const {replies} = await dispatch({text: 'hello', from: admin, chat: privateChat});
    expect(replies[0].message).toContain('Unknown command');
    expect(replies[1].options.reply_markup).toBeDefined();
  });

  test('/targets and /target slash commands', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const list = await dispatch({text: '/targets', from: admin, chat: privateChat});
    expect(list.replies[0].message).toContain('TestSome');
    expect(list.replies[0].message).toContain('groups: 1.1');
    expect(list.replies[0].message).toContain('not assigned');
    const usage = await dispatch({text: '/target add nope', from: admin, chat: privateChat});
    expect(usage.replies[0].message).toContain('Usage: /target');
    await dispatch({text: '/target add -555/3 Night shift', from: admin, chat: privateChat});
    expect(controller.addTarget).toHaveBeenCalledWith({chatId: -555, topicId: 3, label: 'Night shift'});
    await dispatch({text: '/target disable -100/2', from: admin, chat: privateChat});
    expect(controller.updateTarget).toHaveBeenCalledWith('-100:2', {enabled: false});
    await dispatch({text: '/target label -100/2 Main hall', from: admin, chat: privateChat});
    expect(controller.updateTarget).toHaveBeenLastCalledWith('-100:2', {label: 'Main hall'});
    const removed = await dispatch({text: '/target remove -100/2', from: admin, chat: privateChat});
    expect(controller.removeTarget).toHaveBeenCalledWith('-100:2');
    expect(removed.replies[0].message).toContain('Unassigned from groups: 1.1');
  });

  test('/group target assign|unassign|add', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const usage = await dispatch({text: '/group 1.1 target remove nope', from: admin, chat: privateChat});
    expect(usage.replies[0].message).toContain('Usage: /group &lt;id&gt; target');
    const assigned = await dispatch({text: '/group 1.1 target assign -300', from: admin, chat: privateChat});
    expect(controller.assignTarget).toHaveBeenCalledWith('1.1', '-300:0');
    expect(assigned.replies[0].message).toContain('News');
    await dispatch({text: '/group 1.1 target unassign -100/2', from: admin, chat: privateChat});
    expect(controller.unassignTarget).toHaveBeenCalledWith('1.1', '-100:2');
    await dispatch({text: '/group 2.1 target add -700/9 Backup', from: admin, chat: privateChat});
    expect(controller.addTarget).toHaveBeenCalledWith({chatId: -700, topicId: 9, label: 'Backup'}, '2.1');
    const list = await dispatch({text: '/group 1.1 targets', from: admin, chat: privateChat});
    expect(list.replies[0].message).toContain('Telegram targets');
  });
});

describe('management bot menu', () => {
  test('/menu shows the home screen with navigation buttons', async () => {
    const {bot, dispatch} = fakeBot();
    createManagementBot({bot, controller: fakeController(), i18n, logger});
    const {replies} = await dispatch({text: '/menu', from: admin, chat: privateChat});
    expect(replies[0].message).toContain('Main menu');
    expect(buttons(replies[0].options.reply_markup)).toEqual(expect.arrayContaining(['m:status', 'm:groups', 'm:targets', 'm:settings', 'm:admins']));
  });

  test('group screen lists assigned targets with unassign buttons and an assign picker', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const groups = await dispatch({callbackData: 'm:groups', from: admin, chat: privateChat});
    expect(groups.edits[0].message).toContain('Group 1.1');
    expect(buttons(groups.edits[0].options.reply_markup)).toEqual(expect.arrayContaining(['g:1.1', 'ga']));
    const group = await dispatch({callbackData: 'g:1.1', from: admin, chat: privateChat});
    const data = buttons(group.edits[0].options.reply_markup);
    expect(data).toEqual(expect.arrayContaining(['ge:1.1:calendarId', 'gc:1.1:calendarId', 'tg:-100_2:1.1', 'tu:1.1:-100_2', 'tas:1.1', 'gr:1.1', 'm:groups']));
    expect(group.edits[0].message).toContain('TestSome');
    const picker = await dispatch({callbackData: 'tas:1.1', from: admin, chat: privateChat});
    expect(buttons(picker.edits[0].options.reply_markup)).toEqual(['taa:1.1:-300_0', 'ta:1.1', 'g:1.1']);
    await dispatch({callbackData: 'taa:1.1:-300_0', from: admin, chat: privateChat});
    expect(controller.assignTarget).toHaveBeenCalledWith('1.1', '-300:0');
    await dispatch({callbackData: 'tu:1.1:-100_2', from: admin, chat: privateChat});
    expect(controller.unassignTarget).toHaveBeenCalledWith('1.1', '-100:2');
    const add = await dispatch({callbackData: 'ga', from: admin, chat: privateChat});
    expect(add.edits[0].message).toContain('4 known from Yasno');
    expect(buttons(add.edits[0].options.reply_markup)).toEqual(['g:1.2', 'g:2.1', 'g:60.1', 'gt', 'm:groups']);
  });

  test('targets screen and target detail: toggle, relabel, remove with confirmation', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const list = await dispatch({callbackData: 'm:targets', from: admin, chat: privateChat});
    expect(buttons(list.edits[0].options.reply_markup)).toEqual(['tg:-100_2:-', 'tg:-300_0:-', 'ta:-', 'm:home']);
    const detail = await dispatch({callbackData: 'tg:-100_2:-', from: admin, chat: privateChat});
    expect(detail.edits[0].message).toContain('TestSome');
    expect(detail.edits[0].message).toContain('groups: 1.1');
    expect(buttons(detail.edits[0].options.reply_markup)).toEqual(['te:-100_2:-', 'tl:-100_2:-', 'tr:-100_2:-', 'm:targets']);
    await dispatch({callbackData: 'te:-100_2:-', from: admin, chat: privateChat});
    expect(controller.updateTarget).toHaveBeenCalledWith('-100:2', {enabled: false});
    await dispatch({callbackData: 'tl:-100_2:1.1', from: admin, chat: privateChat});
    const relabeled = await dispatch({text: 'Main chat', from: admin, chat: privateChat});
    expect(controller.updateTarget).toHaveBeenLastCalledWith('-100:2', {label: 'Main chat'});
    expect(buttons(relabeled.replies[0].options.reply_markup)).toContain('g:1.1'); // back to the group it was opened from
    const ask = await dispatch({callbackData: 'tr:-100_2:-', from: admin, chat: privateChat});
    expect(ask.edits[0].message).toContain('unassigned from groups: 1.1');
    expect(buttons(ask.edits[0].options.reply_markup)).toEqual(['trc:-100_2:-', 'tg:-100_2:-']);
    expect(controller.removeTarget).not.toHaveBeenCalled();
    const done = await dispatch({callbackData: 'trc:-100_2:-', from: admin, chat: privateChat});
    expect(controller.removeTarget).toHaveBeenCalledWith('-100:2');
    expect(buttons(done.edits[0].options.reply_markup)).toEqual(['tg:-300_0:-', 'ta:-', 'm:home']);
  });

  test('add-target wizard in bot mode: type, typed chat id, topic prompt, assignment context', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const types = await dispatch({callbackData: 'ta:1.1', from: admin, chat: privateChat});
    expect(buttons(types.edits[0].options.reply_markup)).toEqual(expect.arrayContaining(['tb:1.1:user:0', 'tb:1.1:topic:0', 'tas:1.1']));
    const prompt = await dispatch({callbackData: 'tb:1.1:topic:0', from: admin, chat: privateChat});
    expect(controller.listDialogs).toHaveBeenCalledWith('topic', false);
    expect(prompt.edits[0].message).toContain('Send the chat id');
    const bad = await dispatch({text: 'abc', from: admin, chat: privateChat});
    expect(bad.replies[0].message).toContain('Send the chat id');
    const needTopic = await dispatch({text: '-200', from: admin, chat: privateChat});
    expect(needTopic.replies[0].message).toContain('Send the topic id');
    const created = await dispatch({text: '15', from: admin, chat: privateChat});
    expect(controller.addTarget).toHaveBeenCalledWith({type: 'topic', chatId: -200, topicId: 15}, '1.1');
    expect(buttons(created.replies[0].options.reply_markup)).toEqual(['te:-200_15:1.1', 'tl:-200_15:1.1', 'tr:-200_15:1.1', 'g:1.1']);

    // From the Targets list the context is "-": no assignment, back goes to the list.
    const fromList = await dispatch({callbackData: 'ti:-:channel', from: admin, chat: privateChat});
    expect(fromList.edits[0].message).toContain('Send the chat id');
    const createdGlobal = await dispatch({text: '-300/4', from: admin, chat: privateChat});
    expect(controller.addTarget).toHaveBeenLastCalledWith({type: 'channel', chatId: -300, topicId: 4}, null);
    expect(buttons(createdGlobal.replies[0].options.reply_markup)).toContain('m:targets');
    const after = await dispatch({text: 'again', from: admin, chat: privateChat});
    expect(after.replies[0].message).toContain('Unknown command');
  });

  test('add-target wizard in user mode lists chats (paged) and topics', async () => {
    const {bot, dispatch} = fakeBot();
    const dialogs = Array.from({length: 12}, (_, index) => ({chatId: -1000 - index, title: `Forum ${index}`, type: 'group', isForum: true}));
    const controller = fakeController({
      listDialogs: jest.fn(async () => dialogs),
      listTopics: jest.fn(async () => [{topicId: 7, title: 'Power'}, {topicId: 9, title: 'Chat'}]),
    });
    createManagementBot({bot, controller, i18n, logger});
    const page1 = await dispatch({callbackData: 'tb:-:topic:0', from: admin, chat: privateChat});
    const data1 = buttons(page1.edits[0].options.reply_markup);
    expect(data1).toContain('ts:-:topic:-1000');
    expect(data1).not.toContain('ts:-:topic:-1011');
    expect(data1).toEqual(expect.arrayContaining(['tb:-:topic:1', 'tf:-:topic', 'ti:-:topic', 'ta:-']));
    const page2 = await dispatch({callbackData: 'tb:-:topic:1', from: admin, chat: privateChat});
    expect(buttons(page2.edits[0].options.reply_markup)).toEqual(expect.arrayContaining(['ts:-:topic:-1011', 'tb:-:topic:0']));
    const topics = await dispatch({callbackData: 'ts:-:topic:-1003', from: admin, chat: privateChat});
    expect(controller.listTopics).toHaveBeenCalledWith(-1003);
    expect(buttons(topics.edits[0].options.reply_markup)).toEqual(['tt:-:-1003:7', 'tt:-:-1003:9', 'tj:-:-1003', 'tb:-:topic:0']);
    await dispatch({callbackData: 'tt:-:-1003:9', from: admin, chat: privateChat});
    expect(controller.addTarget).toHaveBeenCalledWith({type: 'topic', chatId: -1003, topicId: 9}, null);
    await dispatch({callbackData: 'ts:2.1:group:-1005', from: admin, chat: privateChat});
    expect(controller.addTarget).toHaveBeenLastCalledWith({type: 'group', chatId: -1005, topicId: null}, '2.1');
  });

  test('editing a group field prompts, consumes the next text message and applies it', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const prompt = await dispatch({callbackData: 'ge:3.2:calendarId', from: admin, chat: privateChat});
    expect(prompt.edits[0].message).toContain('Send the new value');
    const answer = await dispatch({text: 'new@calendar', from: admin, chat: privateChat});
    expect(controller.setGroupField).toHaveBeenCalledWith('3.2', 'calendarId', 'new@calendar');
    expect(answer.replies[0].message).toContain('updated');
    expect(answer.replies[1].options.reply_markup).toBeDefined();
  });

  test('a pending prompt can be cancelled and validation errors keep it open', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController({setGroupField: jest.fn().mockRejectedValue(new Error('Calendar id must be a non-empty string'))});
    createManagementBot({bot, controller, i18n, logger});
    await dispatch({callbackData: 'ge:1.1:calendarId', from: admin, chat: privateChat});
    const bad = await dispatch({text: 'abc', from: admin, chat: privateChat});
    expect(bad.replies[0].message).toContain('non-empty string');
    const cancelled = await dispatch({callbackData: 'x:1.1', from: admin, chat: privateChat});
    expect(cancelled.answers[0].text).toBe('Cancelled.');
    expect(cancelled.edits[0].message).toContain('Group 1.1');
    const after = await dispatch({text: '-100', from: admin, chat: privateChat});
    expect(after.replies[0].message).toContain('Unknown command');
  });

  test('settings toggles and interval prompt', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const toggled = await dispatch({callbackData: 's:t:pinMessage', from: admin, chat: privateChat});
    expect(controller.setOption).toHaveBeenCalledWith('pinMessage', true);
    expect(toggled.edits[0].message).toContain('Settings');
    await dispatch({callbackData: 's:i', from: admin, chat: privateChat});
    const tooBig = await dispatch({text: '999', from: admin, chat: privateChat});
    expect(tooBig.replies[0].message).toContain('1–120');
    await dispatch({text: '15', from: admin, chat: privateChat});
    expect(controller.setOption).toHaveBeenCalledWith('scheduleUpdateInterval', 15);
  });

  test('group removal asks for confirmation; admins cannot remove themselves', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const ask = await dispatch({callbackData: 'gr:1.1', from: admin, chat: privateChat});
    expect(buttons(ask.edits[0].options.reply_markup)).toEqual(['grc:1.1', 'g:1.1']);
    expect(controller.removeGroup).not.toHaveBeenCalled();
    await dispatch({callbackData: 'grc:1.1', from: admin, chat: privateChat});
    expect(controller.removeGroup).toHaveBeenCalledWith('1.1');
    const admins = await dispatch({callbackData: 'm:admins', from: admin, chat: privateChat});
    expect(buttons(admins.edits[0].options.reply_markup)).toEqual(['a:rm:2', 'a:add', 'm:home']);
    const self = await dispatch({callbackData: 'a:rmc:1', from: admin, chat: privateChat});
    expect(self.answers[0].show_alert).toBe(true);
    expect(controller.removeAdmin).not.toHaveBeenCalled();
    await dispatch({callbackData: 'a:rmc:2', from: admin, chat: privateChat});
    expect(controller.removeAdmin).toHaveBeenCalledWith(2);
  });
});
