/** @module management/menu — BotFather-style inline keyboard navigation for the management bot. **/

const {InlineKeyboard} = require('grammy');
const {normalizeGroupId, GROUP_FIELDS} = require('../config/settings');
const {escapeHtml, FIELD_LABELS} = require('./texts');

const PENDING_TTL_MS = 10 * 60 * 1000;
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
  const {__, yesNo, formatGroup, statusText, scheduleText, helpText, adminsText} = texts;
  /** @type {Map<number, {kind: string, groupId?: string, field?: string, expires: number}>} */
  const pending = new Map();

  const back = (keyboard, target = 'm:home') => keyboard.row().text(`⬅️ ${__('Back')}`, target);

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
    let hint = '';
    if (field === 'telegramChatId') {
      hint = `\n${__('Tip: send /whoami inside the target group to learn its chat id and topic id.')}`;
    } else if (field === 'svitlobotChannelIds') {
      hint = `\n${__('Several keys can be separated by commas.')}`;
    }
    return {text: escapeHtml(`${prompt}${hint}`), keyboard};
  }

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

  async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const [kind, ...parts] = data.split(':');
    try {
      if (kind === 'm') {
        pending.delete(userId);
        const target = parts[0];
        const screens = {
          home: homeScreen,
          status: statusScreen,
          schedule: () => scheduleScreen(),
          groups: groupsScreen,
          settings: settingsScreen,
          admins: () => adminsScreen(userId),
          help: helpScreen,
        };
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
        if (screens[target]) {
          await ctx.answerCallbackQuery();
          await show(ctx, screens[target]());
          return;
        }
      } else if (kind === 'x') {
        pending.delete(userId);
        await ctx.answerCallbackQuery({text: __('Cancelled.')});
        await show(ctx, screenForCancelTarget(parts[0], userId));
        return;
      } else if (kind === 'sc') {
        const groupId = normalizeGroupId(parts[0]);
        await ctx.answerCallbackQuery();
        await show(ctx, scheduleScreen(groupId));
        return;
      } else if (kind === 'ga') {
        await ctx.answerCallbackQuery();
        await show(ctx, addGroupScreen());
        return;
      } else if (kind === 'gt') {
        setPending(userId, {kind: 'addGroup'});
        await ctx.answerCallbackQuery();
        await show(ctx, typeGroupScreen());
        return;
      } else if (['g', 'ge', 'gc', 'gr', 'grc'].includes(kind)) {
        const groupId = normalizeGroupId(parts[0]);
        if (groupId === null) {
          await ctx.answerCallbackQuery({text: __('Invalid group id: {value}', {value: parts[0]})});
          return;
        }
        if (kind === 'g') {
          pending.delete(userId);
          await ctx.answerCallbackQuery();
          await show(ctx, groupScreen(groupId));
          return;
        }
        if (kind === 'gr') {
          await ctx.answerCallbackQuery();
          await show(ctx, groupRemoveScreen(groupId));
          return;
        }
        if (kind === 'grc') {
          await controller.removeGroup(groupId);
          await ctx.answerCallbackQuery({text: __('Group {group} removed.', {group: groupId})});
          await show(ctx, groupsScreen());
          return;
        }
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
      } else if (kind === 's') {
        if (parts[0] === 't' && TOGGLE_OPTIONS.includes(parts[1])) {
          const current = controller.getStatus().options[parts[1]];
          const applied = await controller.setOption(parts[1], !current);
          await ctx.answerCallbackQuery({text: __('{option} is now {value}.', {option: __(OPTION_LABELS[parts[1]]), value: yesNo(applied)})});
          await show(ctx, settingsScreen());
          return;
        }
        if (parts[0] === 'i') {
          setPending(userId, {kind: 'interval'});
          await ctx.answerCallbackQuery();
          await show(ctx, intervalScreen());
          return;
        }
      } else if (kind === 'a') {
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
      }
      await ctx.answerCallbackQuery();
    } catch (error) {
      logger.warn(`Management] [Menu action ${data} failed: ${error?.message || error}`);
      await ctx.answerCallbackQuery({text: `⚠️ ${String(error?.message || error).slice(0, 180)}`, show_alert: true}).catch(() => {});
    }
  }

  // ---------- text input for pending prompts ----------

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
      if (entry.kind === 'addGroup') {
        const groupId = normalizeGroupId(value);
        if (groupId === null) {
          await notify(ctx, escapeHtml(__('Invalid group id: {value}', {value})));
          return true;
        }
        const yasnoIds = controller.getYasnoGroupIds();
        if (yasnoIds.length > 0 && !yasnoIds.includes(groupId)) {
          await notify(ctx, escapeHtml(__('Unknown Yasno group {group}.', {group: groupId})));
          return true;
        }
        pending.delete(userId);
        await show(ctx, groupScreen(groupId), {forceNew: true});
        return true;
      }
      if (entry.kind === 'groupField') {
        const group = await controller.setGroupField(entry.groupId, entry.field, value);
        pending.delete(userId);
        await notify(ctx, `✅ ${escapeHtml(__('{field} for group {group} updated.', {field: __(FIELD_LABELS[entry.field]), group: entry.groupId}))}`);
        await show(ctx, groupScreen(group.id ?? entry.groupId), {forceNew: true});
        return true;
      }
      if (entry.kind === 'interval') {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
          await notify(ctx, escapeHtml(__('Send the new check interval in minutes (1–120):')));
          return true;
        }
        const applied = await controller.setOption('scheduleUpdateInterval', minutes);
        pending.delete(userId);
        await notify(ctx, `✅ ${escapeHtml(__('Check interval set to {value} min.', {value: applied}))}`);
        await show(ctx, settingsScreen(), {forceNew: true});
        return true;
      }
      if (entry.kind === 'admin') {
        const id = Number.parseInt(value, 10);
        if (!Number.isInteger(id) || id <= 0) {
          await notify(ctx, escapeHtml(__('Send the Telegram user id of the new admin:')));
          return true;
        }
        controller.addAdmin(id);
        pending.delete(userId);
        await notify(ctx, `✅ ${escapeHtml(__('Admin {id} added.', {id}))}`);
        await show(ctx, adminsScreen(userId), {forceNew: true});
        return true;
      }
    } catch (error) {
      await notify(ctx, `⚠️ ${escapeHtml(error.message)}\n${escapeHtml(__('Try again or press Cancel.'))}`);
      return true;
    }
    pending.delete(userId);
    return false;
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
