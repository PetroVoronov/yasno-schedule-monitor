/** @module management/management
 *
 * Telegram management interface. Commands are accepted only from whitelisted admin user ids and,
 * except for /whoami, only in a private chat with the bot. The chats where schedule updates are
 * posted are never used for management.
 **/

const {normalizeGroupId, GROUP_FIELDS, parseTargetRef, targetKey} = require('../config/settings');
const {createTexts, escapeHtml, formatMinutes, formatDuration, FIELD_LABELS, COMMAND_DESCRIPTIONS} = require('./texts');
const {registerMenu} = require('./menu');

const FIELD_ALIASES = {
  calendar: 'calendarId',
  calendarid: 'calendarId',
  svitlobot: 'svitlobotChannelIds',
  svitlobotchannelids: 'svitlobotChannelIds',
};

const BOOLEAN_TRUE = ['on', 'yes', 'true', '1', 'enable', 'enabled', 'так', 'увімк'];
const BOOLEAN_FALSE = ['off', 'no', 'false', '0', 'disable', 'disabled', 'ні', 'вимк'];

const BOOLEAN_OPTIONS = {
  pin: 'pinMessage',
  unpinprev: 'unpinPrevious',
  ignorestatus: 'ignoreStatus',
  debug: 'debug',
};

function splitArgs(text) {
  if (typeof text !== 'string') {
    return [];
  }
  return text.trim().split(/\s+/).filter((item) => item.length > 0);
}

function parseBoolean(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (BOOLEAN_TRUE.includes(text)) {
    return true;
  }
  if (BOOLEAN_FALSE.includes(text)) {
    return false;
  }
  return null;
}

function resolveField(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (GROUP_FIELDS.includes(value)) {
    return value;
  }
  return FIELD_ALIASES[key] || null;
}

/**
 * Create the management interface on top of a grammY Bot instance.
 *
 * @param {object} params
 * @param {import('grammy').Bot} params.bot - grammY bot used for polling.
 * @param {object} params.controller - Application callbacks (see index.js).
 * @param {object} params.i18n - i18n instance with `__`.
 * @param {object} params.logger - Logger with debug/info/warn/error.
 * @param {string} [params.timeZone]
 * @returns {{start: () => Promise<void>, stop: () => Promise<void>, isRunning: () => boolean}}
 */
function createManagementBot({bot, controller, i18n, logger, timeZone = 'Europe/Kiev'}) {
  const texts = createTexts({controller, i18n, timeZone});
  const {__, yesNo, helpText, formatGroup, formatTarget, targetsText, statusText, scheduleText, whoamiText, adminsText, statusesText} = texts;

  const isAdmin = (userId) => controller.getAdminIds().includes(userId);

  async function reply(ctx, text) {
    const options = {parse_mode: 'HTML', link_preview_options: {is_disabled: true}};
    if (ctx.msg?.message_thread_id !== undefined && ctx.chat?.type !== 'private') {
      options.message_thread_id = ctx.msg.message_thread_id;
    }
    return ctx.reply(text, options);
  }

  // ---- middleware: admin whitelist ----
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) {
      logger.debug(`Management] [Ignoring update from non-admin user ${userId ?? 'unknown'} in chat ${ctx.chat?.id ?? 'unknown'}`);
      return;
    }
    await next();
  });

  // /whoami works in any chat, the answer goes to the admin privately when possible.
  bot.command('whoami', async (ctx) => {
    const text = whoamiText(ctx);
    if (ctx.chat.type === 'private') {
      await reply(ctx, text);
      return;
    }
    try {
      await ctx.api.sendMessage(ctx.from.id, text, {parse_mode: 'HTML'});
    } catch (error) {
      logger.debug(`Management] [Unable to send /whoami privately to ${ctx.from.id}: ${error}`);
      await reply(ctx, text);
    }
  });

  // Everything else only in a private chat with an admin; commands in groups are ignored silently.
  const priv = bot.chatType('private');
  const menu = registerMenu({composer: priv, controller, texts, logger});

  priv.command(['start', 'menu'], async (ctx) => {
    await menu.showHome(ctx);
  });

  priv.command('help', async (ctx) => {
    await reply(ctx, helpText());
  });

  priv.command('cancel', async (ctx) => {
    await menu.cancel(ctx);
  });

  priv.command('version', async (ctx) => {
    const status = controller.getStatus();
    await reply(ctx, `${escapeHtml(status.name)} v${escapeHtml(status.version)}`);
  });

  priv.command('status', async (ctx) => {
    await reply(ctx, statusText());
  });

  priv.command('check', async (ctx) => {
    await reply(ctx, escapeHtml(__('Checking Yasno now…')));
    const result = await controller.forceCheck();
    if (result.error) {
      await reply(ctx, `⚠️ ${escapeHtml(__('Check failed'))}: ${escapeHtml(result.error)}`);
    } else if (result.skipped) {
      await reply(ctx, escapeHtml(__('A check was already in progress.')));
    } else {
      await reply(ctx, escapeHtml(result.changed ? __('Check finished: schedule changes processed.') : __('Check finished: no changes.')));
    }
  });

  priv.command('schedule', async (ctx) => {
    const [rawGroup] = splitArgs(ctx.match);
    let groupId = null;
    if (rawGroup) {
      groupId = normalizeGroupId(rawGroup);
      if (groupId === null) {
        await reply(ctx, escapeHtml(__('Invalid group id: {value}', {value: rawGroup})));
        return;
      }
    }
    await reply(ctx, scheduleText(groupId));
  });

  priv.command('groups', async (ctx) => {
    const groups = controller.getStatus().groups;
    if (groups.length === 0) {
      await reply(ctx, escapeHtml(__('No groups configured. Use /group <id> set calendar <calendar id>.')));
      return;
    }
    await reply(ctx, groups.map(formatGroup).join('\n\n'));
  });

  async function handleGroupTargetCommand(ctx, groupId, args) {
    const usage = __('Usage: /group <id> target assign|unassign <chatId>[/<topicId>] | target add <chatId>[/<topicId>] [label]');
    const [action, rawRef, ...rest] = args;
    const ref = parseTargetRef(rawRef);
    const verb = String(action ?? '').toLowerCase();
    if (!['assign', 'unassign', 'add', 'remove'].includes(verb) || ref === null) {
      await reply(ctx, escapeHtml(usage));
      return;
    }
    const key = targetKey(ref);
    try {
      if (verb === 'add') {
        const target = await controller.addTarget({...ref, label: rest.join(' ')}, groupId);
        await reply(ctx, `✅ ${escapeHtml(__('Target assigned to group {group}.', {group: groupId}))}\n${formatTarget(target)}`);
      } else if (verb === 'assign') {
        const group = await controller.assignTarget(groupId, key);
        await reply(ctx, `✅ ${escapeHtml(__('Target assigned to group {group}.', {group: groupId}))}\n\n${formatGroup(group)}`);
      } else {
        const group = await controller.unassignTarget(groupId, key);
        await reply(ctx, `✅ ${escapeHtml(__('Target unassigned from group {group}.', {group: groupId}))}\n\n${formatGroup(group)}`);
      }
    } catch (error) {
      await reply(ctx, `⚠️ ${escapeHtml(error.message)}`);
    }
  }

  priv.command('targets', async (ctx) => {
    await reply(ctx, targetsText(controller.getTargets()));
  });

  priv.command('target', async (ctx) => {
    const [action, rawRef, ...rest] = splitArgs(ctx.match);
    const usage = __('Usage: /target add <chatId>[/<topicId>] [label] | /target remove|enable|disable <chatId>[/<topicId>] | /target label <chatId>[/<topicId>] <text>');
    const ref = parseTargetRef(rawRef);
    const verb = String(action ?? '').toLowerCase();
    if (!['add', 'remove', 'enable', 'disable', 'label'].includes(verb) || ref === null) {
      await reply(ctx, escapeHtml(usage));
      return;
    }
    const key = targetKey(ref);
    try {
      switch (verb) {
        case 'add': {
          const target = await controller.addTarget({...ref, label: rest.join(' ')});
          await reply(ctx, `✅ ${escapeHtml(__('Target added.'))}\n${formatTarget(target)}`);
          break;
        }
        case 'remove': {
          const affected = await controller.removeTarget(key);
          const suffix = affected.length > 0 ? ` ${escapeHtml(__('Unassigned from groups: {groups}', {groups: affected.join(', ')}))}` : '';
          await reply(ctx, `✅ ${escapeHtml(__('Target removed.'))}${suffix}`);
          break;
        }
        case 'label': {
          const label = rest.join(' ').trim();
          const target = await controller.updateTarget(key, {label: label === '-' ? null : label});
          await reply(ctx, `✅ ${formatTarget(target)}`);
          break;
        }
        default: {
          const target = await controller.updateTarget(key, {enabled: verb === 'enable'});
          await reply(ctx, `✅ ${formatTarget(target)}`);
        }
      }
    } catch (error) {
      await reply(ctx, `⚠️ ${escapeHtml(error.message)}`);
    }
  });

  priv.command('group', async (ctx) => {
    const [rawGroup, action, rawField, ...rest] = splitArgs(ctx.match);
    const usage = __('Usage: /group <id> | /group <id> set <field> <value> | /group <id> unset <field> | /group <id> target …');
    if (!rawGroup) {
      await reply(ctx, escapeHtml(usage));
      return;
    }
    const groupId = normalizeGroupId(rawGroup);
    if (groupId === null) {
      await reply(ctx, escapeHtml(__('Invalid group id: {value}', {value: rawGroup})));
      return;
    }
    if (!action) {
      const group = controller.getStatus().groups.find((item) => item.id === groupId);
      await reply(ctx, group ? formatGroup(group) : escapeHtml(__('Group {group} is not configured.', {group: groupId})));
      return;
    }
    if (['target', 'targets'].includes(action.toLowerCase())) {
      if (rawField === undefined) {
        const group = controller.getGroup(groupId);
        await reply(ctx, formatGroup(group));
        return;
      }
      await handleGroupTargetCommand(ctx, groupId, [rawField, ...rest]);
      return;
    }
    const field = resolveField(rawField);
    if (!['set', 'unset'].includes(action.toLowerCase()) || field === null) {
      await reply(ctx, escapeHtml(usage));
      return;
    }
    try {
      if (action.toLowerCase() === 'set') {
        const value = rest.join(' ').trim();
        if (value.length === 0) {
          await reply(ctx, escapeHtml(usage));
          return;
        }
        const group = await controller.setGroupField(groupId, field, value);
        await reply(ctx, `✅ ${escapeHtml(__('{field} for group {group} updated.', {field: __(FIELD_LABELS[field]), group: groupId}))}\n\n${formatGroup(group)}`);
      } else {
        const group = await controller.unsetGroupField(groupId, field);
        await reply(ctx, `✅ ${escapeHtml(__('{field} for group {group} removed.', {field: __(FIELD_LABELS[field]), group: groupId}))}\n\n${formatGroup(group)}`);
      }
    } catch (error) {
      await reply(ctx, `⚠️ ${escapeHtml(error.message)}`);
    }
  });

  priv.command('interval', async (ctx) => {
    const [raw] = splitArgs(ctx.match);
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
      await reply(ctx, escapeHtml(__('Usage: /interval <minutes between 1 and 120>')));
      return;
    }
    try {
      const applied = await controller.setOption('scheduleUpdateInterval', minutes);
      await reply(ctx, `✅ ${escapeHtml(__('Check interval set to {value} min.', {value: applied}))}`);
    } catch (error) {
      await reply(ctx, `⚠️ ${escapeHtml(error.message)}`);
    }
  });

  for (const [command, option] of Object.entries(BOOLEAN_OPTIONS)) {
    priv.command(command, async (ctx) => {
      const [raw] = splitArgs(ctx.match);
      const value = parseBoolean(raw);
      if (value === null) {
        const current = controller.getStatus().options[option];
        await reply(ctx, `${escapeHtml(__('Current value'))}: ${yesNo(current)}\n${escapeHtml(__('Usage: /{command} on|off', {command}))}`);
        return;
      }
      try {
        const applied = await controller.setOption(option, value);
        await reply(ctx, `✅ ${escapeHtml(__('{option} is now {value}.', {option, value: yesNo(applied)}))}`);
      } catch (error) {
        await reply(ctx, `⚠️ ${escapeHtml(error.message)}`);
      }
    });
  }

  priv.command('statuses', async (ctx) => {
    await reply(ctx, statusesText());
  });

  priv.command('admins', async (ctx) => {
    await reply(ctx, adminsText());
  });

  priv.command('admin', async (ctx) => {
    const [action, rawId] = splitArgs(ctx.match);
    const userId = Number.parseInt(rawId, 10);
    const usage = __('Usage: /admin add|remove <user id>');
    if (!['add', 'remove'].includes(String(action).toLowerCase()) || !Number.isInteger(userId) || userId <= 0) {
      await reply(ctx, escapeHtml(usage));
      return;
    }
    try {
      if (action.toLowerCase() === 'add') {
        controller.addAdmin(userId);
        await reply(ctx, `✅ ${escapeHtml(__('Admin {id} added.', {id: userId}))}`);
      } else {
        if (userId === ctx.from.id) {
          await reply(ctx, `⚠️ ${escapeHtml(__('You cannot remove yourself.'))}`);
          return;
        }
        controller.removeAdmin(userId);
        await reply(ctx, `✅ ${escapeHtml(__('Admin {id} removed.', {id: userId}))}`);
      }
    } catch (error) {
      await reply(ctx, `⚠️ ${escapeHtml(error.message)}`);
    }
  });

  // Plain text: answer to a menu prompt, otherwise show the menu.
  priv.on('message:text', async (ctx, next) => {
    if (await menu.handleText(ctx)) {
      return;
    }
    await next();
  });

  priv.on('message', async (ctx) => {
    await ctx.reply(escapeHtml(__('Unknown command. Use /help or /menu.')), {parse_mode: 'HTML'});
    await menu.showHome(ctx);
  });

  bot.catch((error) => {
    logger.error(`Management] [Error while handling update ${error.ctx?.update?.update_id ?? '?'}: ${error.error?.stack || error.error || error}`);
  });

  let started = false;

  async function start() {
    if (started) {
      return;
    }
    started = true;
    try {
      await bot.api.setMyCommands(
        COMMAND_DESCRIPTIONS.map(([command, description]) => ({command, description: __(description).slice(0, 256)})),
        {scope: {type: 'all_private_chats'}},
      );
    } catch (error) {
      logger.warn(`Management] [Unable to register bot commands: ${error}`);
    }
    bot
      .start({
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query'],
        onStart: (me) => logger.info(`Management interface is listening as @${me.username} for admins: ${controller.getAdminIds().join(', ')}`),
      })
      .catch((error) => {
        logger.error(`Management] [Polling stopped with error: ${error?.stack || error}`);
      });
  }

  async function stop() {
    if (started && bot.isRunning()) {
      await bot.stop();
    }
    started = false;
  }

  return {start, stop, isRunning: () => started && bot.isRunning()};
}

module.exports = {
  createManagementBot,
  escapeHtml,
  splitArgs,
  parseBoolean,
  resolveField,
  formatMinutes,
  formatDuration,
  FIELD_ALIASES,
  BOOLEAN_OPTIONS,
};
