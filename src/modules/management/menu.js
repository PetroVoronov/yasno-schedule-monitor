/** @module management/menu — BotFather-style inline keyboard navigation for the management bot. **/

const {InlineKeyboard} = require('grammy');
const {normalizeGroupId, GROUP_FIELDS, TARGET_TYPES, parseTargetRef} = require('../config/settings');
const {escapeHtml, FIELD_LABELS, TARGET_TYPE_LABELS} = require('./texts');

const PENDING_TTL_MS = 10 * 60 * 1000;
const DIALOGS_PER_PAGE = 10;
const TOGGLE_OPTIONS = ['pinMessage', 'unpinPrevious', 'ignoreStatus', 'debug'];
const OPTION_LABELS = {
  pinMessage: 'Pin messages',
  unpinPrevious: 'Unpin previous',
  ignoreStatus: 'Ignore status',
  debug: 'Debug',
};

/**
 * @param {object} params
 * @param {object} params.composer - grammY composer restricted to private chats.
 * @param {object} params.controller
 * @param {object} params.texts - Result of createTexts().
 * @param {object} params.logger
 * @returns {{showHome: (ctx) => Promise<void>, handleText: (ctx) => Promise<boolean>, cancel: (ctx) => Promise<boolean>}}
 */
function registerMenu({composer, controller, texts, logger}) {
  const {__, yesNo, formatGroup, formatTarget, targetName, statusText, scheduleText, helpText, adminsText} = texts;
  /** @type {Map<number, {kind: string, expires: number, [key: string]: any}>} */
  const pending = new Map();

  const back = (keyboard, target = 'm:home') => keyboard.row().text(`⬅️ ${__('Back')}`, target);
  const typeLabel = (type) => __(TARGET_TYPE_LABELS[type] || type);

  function getPending(userId) {
    const entry = pending.get(userId);
    if (!entry) {
      return null;
    }
    if (entry.expires < Date.now()) {
      pending.delete(userId);
      return null;
    }
    return entry;
  }

  function setPending(userId, entry) {
    pending.set(userId, {...entry, expires: Date.now() + PENDING_TTL_MS});
  }

  // ---------- screens ----------

  function homeScreen() {
    const keyboard = new InlineKeyboard()
      .text(`📊 ${__('Status')}`, 'm:status')
      .text(`🔄 ${__('Check now')}`, 'm:check')
      .row()
      .text(`📅 ${__('Schedule')}`, 'm:schedule')
      .text(`👥 ${__('Groups')}`, 'm:groups')
      .row()
      .text(`⚙️ ${__('Settings')}`, 'm:settings')
      .text(`👤 ${__('Admins')}`, 'm:admins')
      .row()
      .text(`❓ ${__('Help')}`, 'm:help');
    const status = controller.getStatus();
    const text = `<b>${escapeHtml(status.name)} v${escapeHtml(status.version)}</b>\n${escapeHtml(__('Main menu'))}`;
    return {text, keyboard};
  }

  function statusScreen() {
    const keyboard = new InlineKeyboard().text(`🔄 ${__('Refresh')}`, 'm:status');
    return {text: statusText(), keyboard: back(keyboard)};
  }

  function scheduleScreen(groupId = null) {
    const keyboard = new InlineKeyboard();
    const groups = controller.getStatus().groups.filter((group) => group.calendarId !== null);
    groups.forEach((group, index) => {
      keyboard.text(group.id === groupId ? `• ${group.id}` : group.id, `sc:${group.id}`);
      if ((index + 1) % 4 === 0) {
        keyboard.row();
      }
    });
    if (groupId !== null) {
      keyboard.row().text(__('All groups'), 'm:schedule');
    }
    return {text: scheduleText(groupId), keyboard: back(keyboard)};
  }

  function groupsScreen() {
    const groups = controller.getStatus().groups;
    const keyboard = new InlineKeyboard();
    groups.forEach((group, index) => {
      keyboard.text(`${group.calendarId !== null ? '✅' : '⚠️'} ${group.id}`, `g:${group.id}`);
      if ((index + 1) % 3 === 0) {
        keyboard.row();
      }
    });
    keyboard.row().text(`➕ ${__('Add group')}`, 'ga');
    const text = groups.length > 0 ? groups.map(formatGroup).join('\n\n') : escapeHtml(__('No groups configured yet.'));
    return {text: `<b>${escapeHtml(__('Groups'))}</b>\n\n${text}`, keyboard: back(keyboard)};
  }

  function addGroupScreen() {
    const known = new Set(controller.getStatus().groups.map((group) => group.id));
    const yasnoIds = controller.getYasnoGroupIds();
    const free = yasnoIds.filter((id) => !known.has(id));
    const keyboard = new InlineKeyboard();
    free.forEach((id, index) => {
      keyboard.text(id, `g:${id}`);
      if ((index + 1) % 6 === 0) {
        keyboard.row();
      }
    });
    if (free.length % 6 !== 0) {
      keyboard.row();
    }
    keyboard.text(`⌨️ ${__('Type a group id')}`, 'gt');
    let text;
    if (yasnoIds.length === 0) {
      text = __('The Yasno group list is not loaded yet. Run a check or type the group id.');
    } else if (free.length === 0) {
      text = __('All groups are already configured.');
    } else {
      text = __('Choose a group to add ({count} known from Yasno):', {count: yasnoIds.length});
    }
    return {text: escapeHtml(text), keyboard: back(keyboard, 'm:groups')};
  }

  function typeGroupScreen() {
    const keyboard = new InlineKeyboard().text(`❌ ${__('Cancel')}`, 'x:groups');
    return {text: escapeHtml(__('Send the group id as shown by Yasno, e.g. 12.1:')), keyboard};
  }

  function groupScreen(groupId) {
    const group = controller.getGroup(groupId);
    const keyboard = new InlineKeyboard();
    for (const field of GROUP_FIELDS) {
      keyboard.text(`✏️ ${__(FIELD_LABELS[field])}`, `ge:${groupId}:${field}`);
      const hasValue = field === 'svitlobotChannelIds' ? group.svitlobotChannelIds.length > 0 : group[field] !== null;
      if (hasValue) {
        keyboard.text(`🧹 ${__('Clear')}`, `gc:${groupId}:${field}`);
      }
      keyboard.row();
    }
    for (const target of group.telegramTargets) {
      let marker = '⏸';
      if (target.enabled) {
        marker = target.error ? '⚠️' : '✅';
      }
      keyboard.text(`${marker} ${targetName(target)}`, `tg:${groupId}:${target.key}`).row();
    }
    keyboard.text(`➕ ${__('Add target')}`, `ta:${groupId}`).row();
    keyboard.text(`📅 ${__('Schedule')}`, `sc:${groupId}`).text(`🗑 ${__('Remove group')}`, `gr:${groupId}`);
    return {text: formatGroup(group), keyboard: back(keyboard, 'm:groups')};
  }

  function groupRemoveScreen(groupId) {
    const keyboard = new InlineKeyboard().text(`🗑 ${__('Yes, remove')}`, `grc:${groupId}`).text(`❌ ${__('Cancel')}`, `g:${groupId}`);
    return {text: escapeHtml(__('Confirm removing group {group}?', {group: groupId})), keyboard};
  }

  function editFieldScreen(groupId, field) {
    const keyboard = new InlineKeyboard().text(`❌ ${__('Cancel')}`, `x:${groupId}`);
    const prompt = __('Send the new value for {field} of group {group}:', {field: __(FIELD_LABELS[field]), group: groupId});
    const hint = field === 'svitlobotChannelIds' ? `\n${__('Several keys can be separated by commas.')}` : '';
    return {text: escapeHtml(`${prompt}${hint}`), keyboard};
  }

  // ---- targets ----

  function findTarget(groupId, key) {
    return controller.getGroup(groupId).telegramTargets.find((target) => target.key === key) ?? null;
  }

  function targetScreen(groupId, key) {
    const target = findTarget(groupId, key);
    if (!target) {
      return groupScreen(groupId);
    }
    const keyboard = new InlineKeyboard()
      .text(target.enabled ? `⏸ ${__('Disable')}` : `▶️ ${__('Enable')}`, `te:${groupId}:${key}`)
      .text(`✏️ ${__('Label')}`, `tl:${groupId}:${key}`)
      .row()
      .text(`🗑 ${__('Remove target')}`, `tr:${groupId}:${key}`);
    const lines = [`<b>${escapeHtml(__('Group {group}', {group: groupId}))} · ${escapeHtml(__('Target'))}</b>`, formatTarget(target)];
    if (target.title) {
      lines.push(`${escapeHtml(__('Chat title'))}: ${escapeHtml(target.title)}`);
    }
    return {text: lines.join('\n'), keyboard: back(keyboard, `g:${groupId}`)};
  }

  function targetRemoveScreen(groupId, key) {
    const target = findTarget(groupId, key);
    const keyboard = new InlineKeyboard().text(`🗑 ${__('Yes, remove')}`, `trc:${groupId}:${key}`).text(`❌ ${__('Cancel')}`, `tg:${groupId}:${key}`);
    return {text: escapeHtml(__('Confirm removing target {target}?', {target: target ? targetName(target) : key})), keyboard};
  }

  function targetTypeScreen(groupId) {
    const keyboard = new InlineKeyboard();
    TARGET_TYPES.forEach((type, index) => {
      keyboard.text(typeLabel(type), `tb:${groupId}:${type}:0`);
      if ((index + 1) % 3 === 0) {
        keyboard.row();
      }
    });
    const text = `<b>${escapeHtml(__('Add target'))}</b>\n${escapeHtml(__('Choose the target type:'))}`;
    return {text, keyboard: back(keyboard, `g:${groupId}`)};
  }

  function typeChatScreen(groupId, type) {
    const keyboard = new InlineKeyboard().text(`❌ ${__('Cancel')}`, `x:${groupId}`);
    const lines = [__('Send the chat id (as <chatId> or <chatId>/<topicId>):')];
    lines.push(__('Tip: send /whoami inside the target group to learn its chat id and topic id.'));
    if (type === 'user' || type === 'bot') {
      lines.push(__('A user must have started a chat with the bot before it can receive messages.'));
    }
    return {text: escapeHtml(lines.join('\n')), keyboard};
  }

  async function chatListScreen(groupId, type, page, force = false) {
    const dialogs = await controller.listDialogs(type, force);
    if (dialogs === null) {
      return null;
    }
    const pages = Math.max(1, Math.ceil(dialogs.length / DIALOGS_PER_PAGE));
    const current = Math.min(Math.max(0, page), pages - 1);
    const keyboard = new InlineKeyboard();
    for (const dialog of dialogs.slice(current * DIALOGS_PER_PAGE, (current + 1) * DIALOGS_PER_PAGE)) {
      keyboard.text(dialog.title.slice(0, 48), `ts:${groupId}:${type}:${dialog.chatId}`).row();
    }
    if (pages > 1) {
      if (current > 0) {
        keyboard.text(`◀️ ${__('Previous')}`, `tb:${groupId}:${type}:${current - 1}`);
      }
      if (current < pages - 1) {
        keyboard.text(`${__('Next')} ▶️`, `tb:${groupId}:${type}:${current + 1}`);
      }
      keyboard.row();
    }
    keyboard.text(`🔄 ${__('Refresh list')}`, `tf:${groupId}:${type}`).text(`⌨️ ${__('Type chat id')}`, `ti:${groupId}:${type}`);
    const lines = [`<b>${escapeHtml(__('Add target'))} · ${escapeHtml(typeLabel(type))}</b>`];
    lines.push(escapeHtml(dialogs.length === 0 ? __('No chats of this type found.') : __('Choose the chat:')));
    if (pages > 1) {
      lines.push(escapeHtml(__('Page {page}/{pages}', {page: current + 1, pages})));
    }
    return {text: lines.join('\n'), keyboard: back(keyboard, `ta:${groupId}`)};
  }

  function typeTopicScreen(groupId) {
    const keyboard = new InlineKeyboard().text(`❌ ${__('Cancel')}`, `x:${groupId}`);
    return {text: escapeHtml(__('Send the topic id:')), keyboard};
  }

  async function topicListScreen(groupId, chatId) {
    const topics = await controller.listTopics(chatId);
    if (topics === null) {
      return null;
    }
    const keyboard = new InlineKeyboard();
    topics.slice(0, 50).forEach((topic, index) => {
      keyboard.text(topic.title.slice(0, 30), `tt:${groupId}:${chatId}:${topic.topicId}`);
      if ((index + 1) % 2 === 0) {
        keyboard.row();
      }
    });
    if (topics.length % 2 !== 0) {
      keyboard.row();
    }
    keyboard.text(`⌨️ ${__('Type topic id')}`, `tj:${groupId}:${chatId}`);
    const lines = [`<b>${escapeHtml(__('Add target'))} · ${escapeHtml(typeLabel('topic'))}</b>`];
    lines.push(escapeHtml(topics.length === 0 ? __('No topics found in this chat.') : __('Choose the topic:')));
    return {text: lines.join('\n'), keyboard: back(keyboard, `tb:${groupId}:topic:0`)};
  }

  function labelScreen(groupId, key) {
    const keyboard = new InlineKeyboard().text(`❌ ${__('Cancel')}`, `tg:${groupId}:${key}`);
    return {text: escapeHtml(__('Send a label for this target (or "-" to clear):')), keyboard};
  }

  async function createTarget(ctx, userId, groupId, input, {forceNew = false} = {}) {
    const target = await controller.addTarget(groupId, input);
    pending.delete(userId);
    await show(ctx, targetScreen(groupId, target.key), {forceNew});
    return target;
  }

  /** After a chat was chosen: ask for the topic when needed, otherwise create the target. */
  async function continueWithChat(ctx, userId, groupId, type, chatId, topicId, {forceNew = false} = {}) {
    if (type === 'topic' && topicId === null) {
      const screen = await topicListScreen(groupId, chatId);
      if (screen === null) {
        setPending(userId, {kind: 'targetTopic', groupId, chatId});
        await show(ctx, typeTopicScreen(groupId), {forceNew});
        return;
      }
      await show(ctx, screen, {forceNew});
      return;
    }
    await createTarget(ctx, userId, groupId, {type, chatId, topicId}, {forceNew});
  }

  // ---- settings / admins ----

  function settingsScreen() {
    const options = controller.getStatus().options;
    const keyboard = new InlineKeyboard();
    for (const option of TOGGLE_OPTIONS) {
      keyboard.text(`${options[option] ? '🟢' : '⚪️'} ${__(OPTION_LABELS[option])}: ${yesNo(options[option])}`, `s:t:${option}`).row();
    }
    keyboard.text(`⏱ ${__('Interval: {value} min', {value: options.scheduleUpdateInterval})}`, 's:i');
    const text = `<b>${escapeHtml(__('Settings'))}</b>\n${escapeHtml(__('Tap a setting to toggle it.'))}`;
    return {text, keyboard: back(keyboard)};
  }

  function intervalScreen() {
    const keyboard = new InlineKeyboard().text(`❌ ${__('Cancel')}`, 'x:settings');
    return {text: escapeHtml(__('Send the new check interval in minutes (1–120):')), keyboard};
  }

  function adminsScreen(selfId) {
    const keyboard = new InlineKeyboard();
    for (const id of controller.getAdminIds()) {
      if (id !== selfId) {
        keyboard.text(`🗑 ${id}`, `a:rm:${id}`).row();
      }
    }
    keyboard.text(`➕ ${__('Add admin')}`, 'a:add');
    return {text: adminsText(), keyboard: back(keyboard)};
  }

  function adminAddScreen() {
    const keyboard = new InlineKeyboard().text(`❌ ${__('Cancel')}`, 'x:admins');
    return {text: escapeHtml(__('Send the Telegram user id of the new admin:')), keyboard};
  }

  function adminRemoveScreen(id) {
    const keyboard = new InlineKeyboard().text(`🗑 ${__('Yes, remove')}`, `a:rmc:${id}`).text(`❌ ${__('Cancel')}`, 'm:admins');
    return {text: escapeHtml(__('Confirm removing admin {id}?', {id})), keyboard};
  }

  function helpScreen() {
    return {text: helpText(), keyboard: back(new InlineKeyboard())};
  }

  // ---------- rendering ----------

  async function show(ctx, screen, {forceNew = false} = {}) {
    const options = {parse_mode: 'HTML', reply_markup: screen.keyboard, link_preview_options: {is_disabled: true}};
    if (ctx.callbackQuery && !forceNew) {
      try {
        await ctx.editMessageText(screen.text, options);
        return;
      } catch (error) {
        if (String(error?.description || error).includes('message is not modified')) {
          return;
        }
        logger.debug(`Management] [editMessageText failed, sending a new message: ${error}`);
      }
    }
    await ctx.reply(screen.text, options);
  }

  async function showHome(ctx) {
    await show(ctx, homeScreen());
  }

  async function notify(ctx, text) {
    await ctx.reply(text, {parse_mode: 'HTML'});
  }

  function screenForCancelTarget(target, selfId) {
    if (target === 'settings') {
      return settingsScreen();
    }
    if (target === 'admins') {
      return adminsScreen(selfId);
    }
    if (target === 'groups') {
      return groupsScreen();
    }
    const groupId = normalizeGroupId(target);
    return groupId ? groupScreen(groupId) : homeScreen();
  }

  // ---------- callback handling ----------

  const menuScreens = {
    home: homeScreen,
    status: statusScreen,
    schedule: () => scheduleScreen(),
    groups: groupsScreen,
    settings: settingsScreen,
    help: helpScreen,
  };

  async function handleMenu(ctx, userId, target) {
    pending.delete(userId);
    if (target === 'check') {
      await ctx.answerCallbackQuery({text: __('Checking Yasno now…')});
      const result = await controller.forceCheck();
      let text;
      if (result.error) {
        text = `⚠️ ${__('Check failed')}: ${result.error}`;
      } else if (result.skipped) {
        text = __('A check was already in progress.');
      } else {
        text = result.changed ? __('Check finished: schedule changes processed.') : __('Check finished: no changes.');
      }
      await show(ctx, {text: escapeHtml(text), keyboard: back(new InlineKeyboard().text(`📊 ${__('Status')}`, 'm:status'))});
      return;
    }
    await ctx.answerCallbackQuery();
    if (target === 'admins') {
      await show(ctx, adminsScreen(userId));
    } else if (menuScreens[target]) {
      await show(ctx, menuScreens[target]());
    }
  }

  async function handleGroupAction(ctx, userId, kind, parts) {
    const groupId = normalizeGroupId(parts[0]);
    if (groupId === null) {
      await ctx.answerCallbackQuery({text: __('Invalid group id: {value}', {value: parts[0]})});
      return;
    }
    switch (kind) {
      case 'g':
        pending.delete(userId);
        await ctx.answerCallbackQuery();
        await show(ctx, groupScreen(groupId));
        return;
      case 'gr':
        await ctx.answerCallbackQuery();
        await show(ctx, groupRemoveScreen(groupId));
        return;
      case 'grc':
        await controller.removeGroup(groupId);
        await ctx.answerCallbackQuery({text: __('Group {group} removed.', {group: groupId})});
        await show(ctx, groupsScreen());
        return;
      case 'ge':
      case 'gc': {
        const field = parts[1];
        if (!GROUP_FIELDS.includes(field)) {
          await ctx.answerCallbackQuery();
          return;
        }
        if (kind === 'ge') {
          setPending(userId, {kind: 'groupField', groupId, field});
          await ctx.answerCallbackQuery();
          await show(ctx, editFieldScreen(groupId, field));
          return;
        }
        await controller.unsetGroupField(groupId, field);
        await ctx.answerCallbackQuery({text: __('{field} for group {group} removed.', {field: __(FIELD_LABELS[field]), group: groupId})});
        await show(ctx, groupScreen(groupId));
        return;
      }
      default:
        await ctx.answerCallbackQuery();
    }
  }

  async function handleTargetAction(ctx, userId, kind, parts) {
    const groupId = normalizeGroupId(parts[0]);
    if (groupId === null) {
      await ctx.answerCallbackQuery({text: __('Invalid group id: {value}', {value: parts[0]})});
      return;
    }
    switch (kind) {
      case 'ta': // choose type
        pending.delete(userId);
        await ctx.answerCallbackQuery();
        await show(ctx, targetTypeScreen(groupId));
        return;
      case 'tb': // list chats of a type (page) or ask for an id
      case 'tf': {
        const type = parts[1];
        if (!TARGET_TYPES.includes(type)) {
          await ctx.answerCallbackQuery();
          return;
        }
        await ctx.answerCallbackQuery();
        const screen = await chatListScreen(groupId, type, Number(parts[2]) || 0, kind === 'tf');
        if (screen === null) {
          setPending(userId, {kind: 'targetChat', groupId, type});
          await show(ctx, typeChatScreen(groupId, type));
        } else {
          await show(ctx, screen);
        }
        return;
      }
      case 'ti': { // type the chat id
        const type = parts[1];
        setPending(userId, {kind: 'targetChat', groupId, type});
        await ctx.answerCallbackQuery();
        await show(ctx, typeChatScreen(groupId, type));
        return;
      }
      case 'ts': { // chat chosen from the list
        const type = parts[1];
        const chatId = Number.parseInt(parts[2], 10);
        await ctx.answerCallbackQuery();
        await continueWithChat(ctx, userId, groupId, type, chatId, null);
        return;
      }
      case 'tj': { // type the topic id
        setPending(userId, {kind: 'targetTopic', groupId, chatId: Number.parseInt(parts[1], 10)});
        await ctx.answerCallbackQuery();
        await show(ctx, typeTopicScreen(groupId));
        return;
      }
      case 'tt': { // topic chosen from the list
        await ctx.answerCallbackQuery({text: __('Target added.')});
        await createTarget(ctx, userId, groupId, {type: 'topic', chatId: Number.parseInt(parts[1], 10), topicId: Number.parseInt(parts[2], 10)});
        return;
      }
      default:
        break;
    }
    const key = parts[1];
    switch (kind) {
      case 'tg':
        pending.delete(userId);
        await ctx.answerCallbackQuery();
        await show(ctx, targetScreen(groupId, key));
        return;
      case 'te': {
        const target = findTarget(groupId, key);
        if (target) {
          await controller.updateTarget(groupId, key, {enabled: !target.enabled});
        }
        await ctx.answerCallbackQuery();
        await show(ctx, targetScreen(groupId, key));
        return;
      }
      case 'tl':
        setPending(userId, {kind: 'targetLabel', groupId, key});
        await ctx.answerCallbackQuery();
        await show(ctx, labelScreen(groupId, key));
        return;
      case 'tr':
        await ctx.answerCallbackQuery();
        await show(ctx, targetRemoveScreen(groupId, key));
        return;
      case 'trc':
        await controller.removeTarget(groupId, key);
        await ctx.answerCallbackQuery({text: __('Target removed.')});
        await show(ctx, groupScreen(groupId));
        return;
      default:
        await ctx.answerCallbackQuery();
    }
  }

  async function handleSettingsAction(ctx, parts) {
    if (parts[0] === 't' && TOGGLE_OPTIONS.includes(parts[1])) {
      const current = controller.getStatus().options[parts[1]];
      const applied = await controller.setOption(parts[1], !current);
      await ctx.answerCallbackQuery({text: __('{option} is now {value}.', {option: __(OPTION_LABELS[parts[1]]), value: yesNo(applied)})});
      await show(ctx, settingsScreen());
      return;
    }
    if (parts[0] === 'i') {
      setPending(ctx.from.id, {kind: 'interval'});
      await ctx.answerCallbackQuery();
      await show(ctx, intervalScreen());
      return;
    }
    await ctx.answerCallbackQuery();
  }

  async function handleAdminAction(ctx, userId, parts) {
    if (parts[0] === 'add') {
      setPending(userId, {kind: 'admin'});
      await ctx.answerCallbackQuery();
      await show(ctx, adminAddScreen());
      return;
    }
    const id = Number.parseInt(parts[1], 10);
    if (parts[0] === 'rm' && Number.isInteger(id)) {
      await ctx.answerCallbackQuery();
      await show(ctx, adminRemoveScreen(id));
      return;
    }
    if (parts[0] === 'rmc' && Number.isInteger(id)) {
      if (id === userId) {
        await ctx.answerCallbackQuery({text: __('You cannot remove yourself.'), show_alert: true});
        return;
      }
      controller.removeAdmin(id);
      await ctx.answerCallbackQuery({text: __('Admin {id} removed.', {id})});
      await show(ctx, adminsScreen(userId));
      return;
    }
    await ctx.answerCallbackQuery();
  }

  async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const [kind, ...parts] = data.split(':');
    try {
      if (kind === 'm') {
        await handleMenu(ctx, userId, parts[0]);
      } else if (kind === 'x') {
        pending.delete(userId);
        await ctx.answerCallbackQuery({text: __('Cancelled.')});
        await show(ctx, screenForCancelTarget(parts[0], userId));
      } else if (kind === 'sc') {
        await ctx.answerCallbackQuery();
        await show(ctx, scheduleScreen(normalizeGroupId(parts[0])));
      } else if (kind === 'ga') {
        await ctx.answerCallbackQuery();
        await show(ctx, addGroupScreen());
      } else if (kind === 'gt') {
        setPending(userId, {kind: 'addGroup'});
        await ctx.answerCallbackQuery();
        await show(ctx, typeGroupScreen());
      } else if (['g', 'ge', 'gc', 'gr', 'grc'].includes(kind)) {
        await handleGroupAction(ctx, userId, kind, parts);
      } else if (['ta', 'tb', 'tf', 'ti', 'ts', 'tj', 'tt', 'tg', 'te', 'tl', 'tr', 'trc'].includes(kind)) {
        await handleTargetAction(ctx, userId, kind, parts);
      } else if (kind === 's') {
        await handleSettingsAction(ctx, parts);
      } else if (kind === 'a') {
        await handleAdminAction(ctx, userId, parts);
      } else {
        await ctx.answerCallbackQuery();
      }
    } catch (error) {
      logger.warn(`Management] [Menu action ${data} failed: ${error?.message || error}`);
      await ctx.answerCallbackQuery({text: `⚠️ ${String(error?.message || error).slice(0, 180)}`, show_alert: true}).catch(() => {});
    }
  }

  // ---------- text input for pending prompts ----------

  async function handlePendingText(ctx, userId, entry, value) {
    switch (entry.kind) {
      case 'addGroup': {
        const groupId = normalizeGroupId(value);
        if (groupId === null) {
          await notify(ctx, escapeHtml(__('Invalid group id: {value}', {value})));
          return;
        }
        const yasnoIds = controller.getYasnoGroupIds();
        if (yasnoIds.length > 0 && !yasnoIds.includes(groupId)) {
          await notify(ctx, escapeHtml(__('Unknown Yasno group {group}.', {group: groupId})));
          return;
        }
        pending.delete(userId);
        await show(ctx, groupScreen(groupId), {forceNew: true});
        return;
      }
      case 'groupField': {
        const group = await controller.setGroupField(entry.groupId, entry.field, value);
        pending.delete(userId);
        await notify(ctx, `✅ ${escapeHtml(__('{field} for group {group} updated.', {field: __(FIELD_LABELS[entry.field]), group: entry.groupId}))}`);
        await show(ctx, groupScreen(group.id ?? entry.groupId), {forceNew: true});
        return;
      }
      case 'targetChat': {
        const ref = parseTargetRef(value);
        if (ref === null) {
          await notify(ctx, escapeHtml(__('Send the chat id (as <chatId> or <chatId>/<topicId>):')));
          return;
        }
        await continueWithChat(ctx, userId, entry.groupId, entry.type, ref.chatId, ref.topicId, {forceNew: true});
        return;
      }
      case 'targetTopic': {
        const topicId = Number.parseInt(value, 10);
        if (!Number.isInteger(topicId) || topicId <= 0) {
          await notify(ctx, escapeHtml(__('Send the topic id:')));
          return;
        }
        await createTarget(ctx, userId, entry.groupId, {type: 'topic', chatId: entry.chatId, topicId}, {forceNew: true});
        return;
      }
      case 'targetLabel': {
        await controller.updateTarget(entry.groupId, entry.key, {label: value === '-' ? null : value});
        pending.delete(userId);
        await show(ctx, targetScreen(entry.groupId, entry.key), {forceNew: true});
        return;
      }
      case 'interval': {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
          await notify(ctx, escapeHtml(__('Send the new check interval in minutes (1–120):')));
          return;
        }
        const applied = await controller.setOption('scheduleUpdateInterval', minutes);
        pending.delete(userId);
        await notify(ctx, `✅ ${escapeHtml(__('Check interval set to {value} min.', {value: applied}))}`);
        await show(ctx, settingsScreen(), {forceNew: true});
        return;
      }
      case 'admin': {
        const id = Number.parseInt(value, 10);
        if (!Number.isInteger(id) || id <= 0) {
          await notify(ctx, escapeHtml(__('Send the Telegram user id of the new admin:')));
          return;
        }
        controller.addAdmin(id);
        pending.delete(userId);
        await notify(ctx, `✅ ${escapeHtml(__('Admin {id} added.', {id}))}`);
        await show(ctx, adminsScreen(userId), {forceNew: true});
        return;
      }
      default:
        pending.delete(userId);
    }
  }

  /**
   * @returns {Promise<boolean>} true when the message was consumed as an answer to a prompt.
   */
  async function handleText(ctx) {
    const userId = ctx.from.id;
    const entry = getPending(userId);
    if (!entry) {
      return false;
    }
    const value = String(ctx.msg.text || '').trim();
    if (value.startsWith('/')) {
      return false;
    }
    try {
      await handlePendingText(ctx, userId, entry, value);
    } catch (error) {
      await notify(ctx, `⚠️ ${escapeHtml(error.message)}\n${escapeHtml(__('Try again or press Cancel.'))}`);
    }
    return true;
  }

  async function cancel(ctx) {
    const had = pending.delete(ctx.from.id);
    await notify(ctx, escapeHtml(had ? __('Cancelled.') : __('No pending input.')));
    return had;
  }

  composer.on('callback_query:data', handleCallback);

  return {showHome, handleText, cancel};
}

module.exports = {
  registerMenu,
  TOGGLE_OPTIONS,
  OPTION_LABELS,
};
