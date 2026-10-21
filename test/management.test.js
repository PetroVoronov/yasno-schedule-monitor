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
    expect(resolveField('Chat')).toBe('telegramChatId');
    expect(resolveField('topic')).toBe('telegramTopicId');
    expect(resolveField('svitlobot')).toBe('svitlobotChannelIds');
    expect(resolveField('telegramChatId')).toBe('telegramChatId');
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

function fakeController(overrides = {}) {
  const groups = [{id: '1.1', calendarId: 'cal', telegramChatId: -1, telegramTopicId: null, svitlobotChannelIds: [], chatTitle: 'Chat'}];
  const options = {scheduleUpdateInterval: 5, pinMessage: false, unpinPrevious: false, ignoreStatus: false, debug: false};
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
      groups,
      startedAt: Date.now(),
      lastCheckAt: null,
      lastChangeAt: null,
      lastError: null,
      nextCheckAt: null,
      checkInProgress: false,
      storagePath: 'data/config.json',
    }),
    getGroup: (id) => groups.find((group) => group.id === id) || {id, calendarId: null, telegramChatId: null, telegramTopicId: null, svitlobotChannelIds: [], chatTitle: null},
    getYasnoGroupIds: () => ['1.1', '1.2', '2.1', '60.1'],
    getSchedule: () => null,
    getKnownStatuses: () => ({}),
    forceCheck: jest.fn().mockResolvedValue({changed: true, skipped: false, error: null}),
    setGroupField: jest.fn(async (id, field, value) => ({id, calendarId: field === 'calendarId' ? value : 'cal', telegramChatId: null, telegramTopicId: null, svitlobotChannelIds: [], chatTitle: null})),
    unsetGroupField: jest.fn(),
    removeGroup: jest.fn(),
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
});

describe('management bot menu', () => {
  const buttons = (keyboard) => keyboard.inline_keyboard.flat().map((button) => button.callback_data);

  test('/menu shows the home screen with navigation buttons', async () => {
    const {bot, dispatch} = fakeBot();
    createManagementBot({bot, controller: fakeController(), i18n, logger});
    const {replies} = await dispatch({text: '/menu', from: admin, chat: privateChat});
    expect(replies[0].message).toContain('Main menu');
    expect(buttons(replies[0].options.reply_markup)).toEqual(expect.arrayContaining(['m:status', 'm:groups', 'm:settings', 'm:admins']));
  });

  test('navigation edits the same message and group screen lists fields', async () => {
    const {bot, dispatch} = fakeBot();
    createManagementBot({bot, controller: fakeController(), i18n, logger});
    const groups = await dispatch({callbackData: 'm:groups', from: admin, chat: privateChat});
    expect(groups.edits[0].message).toContain('Group 1.1');
    expect(buttons(groups.edits[0].options.reply_markup)).toEqual(expect.arrayContaining(['g:1.1', 'ga']));
    const group = await dispatch({callbackData: 'g:1.1', from: admin, chat: privateChat});
    const data = buttons(group.edits[0].options.reply_markup);
    expect(data).toEqual(expect.arrayContaining(['ge:1.1:calendarId', 'gc:1.1:calendarId', 'ge:1.1:telegramTopicId', 'gr:1.1', 'm:groups']));
    expect(data).not.toContain('gc:1.1:telegramTopicId');
    const add = await dispatch({callbackData: 'ga', from: admin, chat: privateChat});
    expect(add.edits[0].message).toContain('4 known from Yasno');
    expect(buttons(add.edits[0].options.reply_markup)).toEqual(['g:1.2', 'g:2.1', 'g:60.1', 'gt', 'm:groups']);
    await dispatch({callbackData: 'gt', from: admin, chat: privateChat});
    const unknown = await dispatch({text: '7', from: admin, chat: privateChat});
    expect(unknown.replies[0].message).toContain('Unknown Yasno group 7.1');
    const typed = await dispatch({text: '60', from: admin, chat: privateChat});
    expect(typed.replies[0].message).toContain('Group 60.1');
    expect(buttons(typed.replies[0].options.reply_markup)).toContain('ge:60.1:calendarId');
  });

  test('editing a field prompts, consumes the next text message and applies it', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController();
    createManagementBot({bot, controller, i18n, logger});
    const prompt = await dispatch({callbackData: 'ge:3.2:calendarId', from: admin, chat: privateChat});
    expect(prompt.edits[0].message).toContain('Send the new value');
    const answer = await dispatch({text: 'new@calendar', from: admin, chat: privateChat});
    expect(controller.setGroupField).toHaveBeenCalledWith('3.2', 'calendarId', 'new@calendar');
    expect(answer.replies[0].message).toContain('updated');
    expect(answer.replies[1].options.reply_markup).toBeDefined();
    const after = await dispatch({text: 'again', from: admin, chat: privateChat});
    expect(after.replies[0].message).toContain('Unknown command');
    expect(controller.setGroupField).toHaveBeenCalledTimes(1);
  });

  test('a pending prompt can be cancelled and validation errors keep it open', async () => {
    const {bot, dispatch} = fakeBot();
    const controller = fakeController({setGroupField: jest.fn().mockRejectedValue(new Error('Telegram chat id must be a non-zero integer'))});
    createManagementBot({bot, controller, i18n, logger});
    await dispatch({callbackData: 'ge:1.1:telegramChatId', from: admin, chat: privateChat});
    const bad = await dispatch({text: 'abc', from: admin, chat: privateChat});
    expect(bad.replies[0].message).toContain('non-zero integer');
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
