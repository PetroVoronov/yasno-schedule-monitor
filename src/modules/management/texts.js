/** @module management/texts — HTML text builders shared by slash commands and the button menu. **/

const template = require('string-template');

const FIELD_LABELS = {
  calendarId: 'calendar',
  svitlobotChannelIds: 'svitlobot',
};

const TARGET_TYPE_LABELS = {
  user: 'User',
  bot: 'Bot',
  group: 'Group',
  channel: 'Channel',
  topic: 'Topic',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDateTime(value, timeZone) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('uk-UA', {timeZone, dateStyle: 'short', timeStyle: 'medium'}).format(date);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

const COMMAND_DESCRIPTIONS = [
  ['menu', 'Open the button menu'],
  ['status', 'Show monitor status and configuration'],
  ['check', 'Check Yasno for schedule changes now'],
  ['schedule', 'Show the last fetched schedule'],
  ['groups', 'List configured groups'],
  ['group', 'Show or change a group: /group <id> [set|unset <field> [value] | target …]'],
  ['targets', 'List Telegram targets'],
  ['target', 'Manage a Telegram target: /target add|remove|enable|disable|label …'],
  ['interval', 'Set check interval in minutes'],
  ['pin', 'Pin update messages: on|off'],
  ['unpinprev', 'Unpin previous message after pinning: on|off'],
  ['ignorestatus', 'Process schedules regardless of Yasno status: on|off'],
  ['debug', 'Debug logging: on|off'],
  ['statuses', 'List Yasno statuses seen so far'],
  ['admins', 'List admins'],
  ['admin', 'Add or remove an admin: /admin add|remove <user id>'],
  ['whoami', 'Show your user id and this chat/topic id'],
  ['cancel', 'Cancel the pending input'],
  ['version', 'Show version'],
  ['help', 'Show this help'],
];

/**
 * @param {object} params
 * @param {object} params.controller
 * @param {(key: string, params?: object) => string} params.i18n - i18n instance with `__`.
 * @param {string} params.timeZone
 */
function createTexts({controller, i18n, timeZone}) {
  const __ = (key, params = {}) => template(i18n.__(key), params);
  const yesNo = (value) => (value ? __('on') : __('off'));
  const none = () => __('n/a');

  function helpText() {
    const lines = [`<b>${escapeHtml(__('Available commands'))}</b>`];
    for (const [command, description] of COMMAND_DESCRIPTIONS) {
      lines.push(`/${command} - ${escapeHtml(__(description))}`);
    }
    lines.push('');
    lines.push(escapeHtml(__('Group fields: calendar, svitlobot. Targets are configured once with /target and assigned to groups with /group <id> target assign <chatId>[/<topicId>]. Group ids as in Yasno, e.g. 1.1 or 60.1.')));
    return lines.join('\n');
  }

  /** Short one-line name of a target for buttons and lists. */
  function targetName(target) {
    const base = target.label || target.title || `${__(TARGET_TYPE_LABELS[target.type] || target.type)} ${target.chatId}`;
    return target.topicId !== null && target.topicId !== undefined && !target.label ? `${base} #${target.topicId}` : base;
  }

  function formatTarget(target) {
    const parts = [];
    parts.push(target.enabled ? '✅' : '⏸');
    parts.push(escapeHtml(targetName(target)));
    const details = [`${escapeHtml(__(TARGET_TYPE_LABELS[target.type] || target.type))}`, `<code>${target.chatId}</code>`];
    if (target.topicId !== null && target.topicId !== undefined) {
      details.push(`${escapeHtml(__('topic'))} <code>${target.topicId}</code>`);
    }
    parts.push(`(${details.join(', ')})`);
    if (target.enabled && target.error) {
      parts.push(`⚠️ ${escapeHtml(target.error)}`);
    } else if (target.enabled && target.resolved === false) {
      parts.push(`⚠️ ${escapeHtml(__('not resolved'))}`);
    }
    return parts.join(' ');
  }

  function targetsText(targets) {
    if (targets.length === 0) {
      return escapeHtml(__('No Telegram targets configured yet.'));
    }
    const lines = [`<b>${escapeHtml(__('Telegram targets'))}</b>`];
    for (const target of targets) {
      lines.push(formatTarget(target));
      const used = Array.isArray(target.groups) && target.groups.length > 0 ? target.groups.join(', ') : __('not assigned');
      lines.push(`    ↳ ${escapeHtml(__('groups'))}: ${escapeHtml(used)}`);
    }
    return lines.join('\n');
  }

  function formatGroup(group) {
    const lines = [`<b>${escapeHtml(__('Group {group}', {group: group.id}))}</b>`];
    lines.push(`  ${escapeHtml(__('calendar'))}: <code>${escapeHtml(group.calendarId ?? none())}</code>`);
    const svitlobot = group.svitlobotChannelIds?.length ? group.svitlobotChannelIds.join(', ') : none();
    lines.push(`  ${escapeHtml(__('svitlobot'))}: <code>${escapeHtml(svitlobot)}</code>`);
    const targets = Array.isArray(group.telegramTargets) ? group.telegramTargets : [];
    lines.push(`  ${escapeHtml(__('Telegram targets'))}: ${targets.length === 0 ? escapeHtml(none()) : ''}`);
    for (const target of targets) {
      lines.push(`    ${formatTarget(target)}`);
    }
    if (group.calendarId === null) {
      lines.push(`  ⚠️ ${escapeHtml(__('inactive: no calendar configured'))}`);
    }
    return lines.join('\n');
  }

  function statusText() {
    const status = controller.getStatus();
    const lines = [];
    lines.push(`<b>${escapeHtml(status.name)} v${escapeHtml(status.version)}</b>`);
    lines.push(`${escapeHtml(__('Mode'))}: ${escapeHtml(status.mode)}`);
    lines.push(`${escapeHtml(__('Language'))}: ${escapeHtml(status.language)}`);
    lines.push(`${escapeHtml(__('Uptime'))}: ${escapeHtml(formatDuration(Date.now() - status.startedAt))}`);
    lines.push(`${escapeHtml(__('Check interval'))}: ${status.options.scheduleUpdateInterval} ${escapeHtml(__('min'))}`);
    lines.push(`${escapeHtml(__('Pin messages'))}: ${yesNo(status.options.pinMessage)}`);
    lines.push(`${escapeHtml(__('Unpin previous'))}: ${yesNo(status.options.unpinPrevious)}`);
    lines.push(`${escapeHtml(__('Ignore status'))}: ${yesNo(status.options.ignoreStatus)}`);
    lines.push(`${escapeHtml(__('Debug'))}: ${yesNo(status.options.debug)}`);
    lines.push(`${escapeHtml(__('Last check'))}: ${escapeHtml(formatDateTime(status.lastCheckAt, timeZone) ?? none())}`);
    lines.push(`${escapeHtml(__('Last change'))}: ${escapeHtml(formatDateTime(status.lastChangeAt, timeZone) ?? none())}`);
    lines.push(`${escapeHtml(__('Next check'))}: ${escapeHtml(formatDateTime(status.nextCheckAt, timeZone) ?? none())}`);
    if (status.checkInProgress) {
      lines.push(`⏳ ${escapeHtml(__('A check is in progress'))}`);
    }
    if (status.lastError) {
      lines.push(`⚠️ ${escapeHtml(__('Last error'))}: ${escapeHtml(status.lastError)}`);
    }
    const active = status.groups.filter((group) => group.calendarId !== null).map((group) => group.id);
    lines.push(`${escapeHtml(__('Active groups'))}: ${active.join(', ') || none()}`);
    lines.push(`${escapeHtml(__('Storage'))}: <code>${escapeHtml(status.storagePath)}</code>`);
    return lines.join('\n');
  }

  function scheduleText(groupIdFilter) {
    const schedule = controller.getSchedule();
    if (!schedule) {
      return escapeHtml(__('No schedule has been fetched yet. Use /check.'));
    }
    const groupIds = groupIdFilter ? [groupIdFilter] : Object.keys(schedule.groups);
    const lines = [`<b>${escapeHtml(__('Schedule fetched at {timestamp}', {timestamp: formatDateTime(schedule.fetchedAt, timeZone)}))}</b>`];
    for (const groupId of groupIds) {
      const group = schedule.groups[groupId];
      lines.push('');
      lines.push(`<b>${escapeHtml(__('Group {group}', {group: groupId}))}</b>`);
      if (!group) {
        lines.push(`  ${escapeHtml(__('no data'))}`);
        continue;
      }
      if (group.updatedOn) {
        lines.push(`  ${escapeHtml(__('Data updated at {timestamp}', {timestamp: formatDateTime(group.updatedOn, timeZone)}))}`);
      }
      const days = Object.keys(group.days).sort();
      if (days.length === 0) {
        lines.push(`  ${escapeHtml(__('no data'))}`);
      }
      for (const day of days) {
        let dayLabel = '';
        if (day === schedule.todayStr) {
          dayLabel = ` (${escapeHtml(__('today'))})`;
        } else if (day === schedule.tomorrowStr) {
          dayLabel = ` (${escapeHtml(__('tomorrow'))})`;
        }
        const dayInfo = group.days[day];
        lines.push(`  <u>${escapeHtml(day)}${dayLabel}</u> [${escapeHtml(dayInfo.status ?? none())}]`);
        if (!dayInfo.intervals || dayInfo.intervals.length === 0) {
          lines.push(`    ${escapeHtml(__('no outages!'))}`);
          continue;
        }
        for (const interval of dayInfo.intervals) {
          lines.push(`    🕯 ${formatMinutes(interval.startMinutes)} - ${formatMinutes(interval.endMinutes)}`);
        }
      }
    }
    return lines.join('\n');
  }

  function whoamiText(ctx) {
    const lines = [];
    lines.push(`${escapeHtml(__('Your user id'))}: <code>${ctx.from.id}</code>`);
    lines.push(`${escapeHtml(__('Chat id'))}: <code>${ctx.chat.id}</code> (${escapeHtml(ctx.chat.type)})`);
    if (ctx.chat.title) {
      lines.push(`${escapeHtml(__('Chat title'))}: ${escapeHtml(ctx.chat.title)}`);
    }
    if (ctx.msg?.is_topic_message && ctx.msg.message_thread_id !== undefined) {
      lines.push(`${escapeHtml(__('Topic id'))}: <code>${ctx.msg.message_thread_id}</code>`);
    }
    return lines.join('\n');
  }

  function adminsText() {
    const adminLines = controller
      .getAdminIds()
      .map((id) => `• <code>${id}</code>`)
      .join('\n');
    return `<b>${escapeHtml(__('Admins'))}</b>\n${adminLines}`;
  }

  function statusesText() {
    const statuses = Object.keys(controller.getKnownStatuses());
    if (statuses.length === 0) {
      return escapeHtml(__('No Yasno statuses recorded yet.'));
    }
    const statusLines = statuses.map((status) => `• <code>${escapeHtml(status)}</code>`).join('\n');
    return `<b>${escapeHtml(__('Known Yasno statuses'))}</b>\n${statusLines}`;
  }

  return {__, yesNo, none, helpText, formatGroup, formatTarget, targetName, targetsText, statusText, scheduleText, whoamiText, adminsText, statusesText};
}

module.exports = {
  createTexts,
  escapeHtml,
  formatMinutes,
  formatDateTime,
  formatDuration,
  FIELD_LABELS,
  TARGET_TYPE_LABELS,
  COMMAND_DESCRIPTIONS,
};
