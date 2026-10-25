# yasno-schedule-monitor

Monitors the [Yasno](https://yasno.ua) planned power outage API for Kyiv, mirrors the schedule of the configured groups into Google Calendars, posts changes to Telegram chats or forum topics and, optionally, reflects the weekly timetable to [svitlobot](https://svitlobot.in.ua). Changes can be managed at runtime through a Telegram bot.

## How it works

1. Every `N` minutes the Yasno planned outages endpoint is fetched. When the payload checksum did not change nothing else happens.
2. For every active group (a group with a calendar id) the outage intervals of today and tomorrow are compared with the events already present in its Google Calendar. Missing events are added, outdated ones removed.
3. When the calendar changed, a message is sent to every enabled Telegram target of the group (users, bots, groups, channels or forum topics, optionally pinned) and the svitlobot timetable of the group is updated.

Group ids follow Yasno, e.g. `1.1` or `60.1`. The list of ids is taken from the Yasno API on every check and stored, so the monitor adapts when Yasno changes the number of groups.

## Requirements

- Node.js 22.12 or newer (commander 15 needs `require(esm)`; the Docker image uses Node 25).
- A Google service account JSON key with access to the target calendars, stored as `data/yasno-monitor.json`. Share each calendar with the service account e-mail.
- A Telegram bot token from [@BotFather](https://t.me/BotFather), or (with `--as-user`) Telegram API id/hash for a user session.

## Installation

```bash
npm ci --omit=dev
cp .env.example .env   # fill in the values
node src/index.js
```

Or with Docker:

```bash
docker run -d --name yasno-schedule-monitor \
  -v "$(pwd)/data:/app/data" \
  --env-file .env \
  petrovoronov/yasno-schedule-monitor:latest --pin-message --unpin-previous
```

## Configuration

All configuration and runtime state lives in one file, `data/config.json`, written atomically with mode `0600`. It is created on first start.

Precedence for every setting:

1. A CLI flag that was given explicitly.
2. The value stored in `data/config.json` (what the management bot edits).
3. The environment variable, which only **seeds** an empty field. When a stored value differs from the environment, a warning is logged and the stored value wins.
4. The built-in default.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_AUTH_TOKEN` | Bot token used to post updates (bot mode). |
| `TELEGRAM_MANAGEMENT_BOT_TOKEN` | Optional separate bot for the management interface. Defaults to the posting bot. |
| `TELEGRAM_ADMIN_IDS` | Comma separated Telegram user ids allowed to manage the monitor. Empty disables the management interface. |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Only for `--as-user`. |
| `CALENDAR_ID_GROUP_<g>_<s>` | Google Calendar id for group `g.s`. A group becomes active once it has a calendar id. |
| `TELEGRAM_CHAT_ID_GROUP_<g>_<s>` | Telegram targets for group `g.s`: comma separated `<chatId>` or `<chatId>/<topicId>` entries, e.g. `-1001234567890/2,-1009876543210`. |
| `TELEGRAM_TOPIC_ID_GROUP_<g>_<s>` | Legacy: topic id applied to the first chat id (optional). |
| `SVITLOBOT_CHANNEL_ID_GROUP_<g>_<s>` | Comma separated svitlobot channel keys to update (optional). |

`<g>_<s>` is the group id with the dot replaced by an underscore, e.g. `CALENDAR_ID_GROUP_12_1`. `CALENDAR_ID_GROUP_2` is accepted as `2.1`. Ids that Yasno does not return are rejected with a warning once the group list has been fetched.

### Command line

```text
--as-user                                 Start as user instance (bot instance by default)
-i, --schedule-update-interval <minutes>  Update interval for schedule in minutes (default: 5)
-l, --language <code>                     Language code for i18n: uk, en, de (default: "uk")
-d, --debug                               Enable debug level logging
--pin-message                             Pin update messages in Telegram
--unpin-previous                          Unpin previous messages after pinning a new one
--ignore-status                           Process schedules even if status is not ScheduleApplies
--admin-ids <ids>                         Comma separated Telegram user ids allowed to manage the monitor
--data-dir <path>                         Directory for configuration, state and credentials (default: "data")
```

The interval, pin, unpin, ignore-status and debug settings changed through the management bot are stored and survive restarts unless the corresponding flag is passed explicitly on the command line.

## Management via Telegram

Set `TELEGRAM_ADMIN_IDS` (or `--admin-ids`) to your Telegram user id and start a private chat with the bot. Send `/menu` (or `/start`) for a button-driven interface in the style of BotFather: Status, Check now, Schedule, Groups, Settings, Admins and Help. In Groups you tap a group (or "Add group"), then a field; the bot asks for the value and you simply type it. Settings are toggled with one tap. Every prompt has a Cancel button and `/cancel` also works. The slash commands below do the same things for those who prefer typing. Commands are accepted **only** from listed admins and **only** in a private chat. The chats where schedule updates are posted are never used for management, so no command noise ends up there. Use a dedicated bot for management by setting `TELEGRAM_MANAGEMENT_BOT_TOKEN` if you prefer to keep it separate from the posting bot.

| Command | Description |
| --- | --- |
| `/menu` | Open the button menu. |
| `/status` | Version, mode, options, last/next check, last error, active groups. |
| `/check` | Fetch Yasno now and process changes, ignoring the checksum cache. |
| `/schedule [group]` | Show the last fetched schedule (today and tomorrow) for all or one group. |
| `/groups` | List configured groups with calendar, chat, topic and svitlobot settings. |
| `/group <id>` | Show one group. |
| `/group <id> set <field> <value>` | Set `calendar` or `svitlobot` (comma separated keys). The id must be one Yasno returns. |
| `/group <id> unset <field>` | Remove a field. A group without calendar becomes inactive. |
| `/group <id> targets` | List the Telegram targets assigned to a group. |
| `/group <id> target assign\|unassign <chatId>[/<topicId>]` | Assign an existing target to the group, or remove it from the group. |
| `/group <id> target add <chatId>[/<topicId>] [label]` | Create the target if needed and assign it in one step. |
| `/targets` | List all Telegram targets and the groups using them. |
| `/target add <chatId>[/<topicId>] [label]` | Create a target. The type (user, bot, group, channel, topic) is inferred from the ids. |
| `/target remove\|enable\|disable <chatId>[/<topicId>]` | Delete a target (it is unassigned from every group) or pause it everywhere. |
| `/target label <chatId>[/<topicId>] <text>` | Rename a target (`-` clears the label). |
| `/interval <minutes>` | Change the check interval (1–120). |
| `/pin on\|off`, `/unpinprev on\|off`, `/ignorestatus on\|off`, `/debug on\|off` | Toggle options. Without an argument the current value is shown. |
| `/statuses` | Yasno day statuses seen so far. |
| `/admins`, `/admin add\|remove <user id>` | Manage the admin list. You cannot remove yourself or the last admin. |
| `/whoami` | Your user id and the current chat id. Works inside a group too: the answer is sent to you privately and includes the topic id when sent in a forum topic. Handy for configuring `chat` and `topic`. |
| `/cancel` | Cancel a pending menu prompt. |
| `/version`, `/help` | |

To discover a chat id and topic id, add the bot to the target group, open the topic and send `/whoami` there.

### Telegram targets

Telegram targets are configured once and then assigned to any number of groups, so a chat that should receive several groups' schedules is set up a single time. A target is modelled as in [telegram-forward-user-bot](https://github.com/PetroVoronov/telegram-forward-user-bot): a type (`user`, `bot`, `group`, `channel` or `topic`), a chat id, an optional topic id, an optional label and an enabled flag. Disabling a target pauses it for every group. Pinning and unpinning are tracked per group and target.

In the menu, "Telegram targets" on the main screen lists all targets and lets you add, rename, pause or delete them. Inside a group, "Assign target" offers the existing targets that are not yet assigned, plus "New target". Creating a target starts the same wizard either way: you choose the type first. In user mode (`--as-user`) the bot then lists your chats of that type (and the topics of a forum), so you just tap the one you want. In bot mode the Bot API cannot list chats, so you type the id instead; `/whoami` inside the target chat tells you the chat id and topic id. A bot can only message users who have started a chat with it, and it must be a member (or admin, for channels) of the chats it posts to.

## Storage layout

`data/config.json`:

```json
{
  "version": 3,
  "telegram": { "botToken": "…", "managementBotToken": null, "apiId": null, "apiHash": null, "adminIds": [123456789] },
  "options": { "pinMessage": true },
  "targets": {
    "-1001234567890:2": { "type": "topic", "chatId": -1001234567890, "topicId": 2, "label": "Main", "enabled": true },
    "-1009876543210:0": { "type": "channel", "chatId": -1009876543210, "topicId": null, "label": null, "enabled": true }
  },
  "groups": {
    "1.1": { "calendarId": "…@group.calendar.google.com", "targetKeys": ["-1001234567890:2", "-1009876543210:0"], "svitlobotChannelIds": ["KEY"] },
    "2.1": { "calendarId": "…@group.calendar.google.com", "targetKeys": ["-1009876543210:0"], "svitlobotChannelIds": [] }
  },
  "state": { "lastMessageIds": { "1.1|-1001234567890:2": 578 }, "knownYasnoStatuses": { "ScheduleApplies": { } }, "yasnoGroupIds": ["1.1", "2.1"] },
  "meta": { "legacyImported": true }
}
```

Other files in `data/`: `yasno-monitor.json` (Google key) and `session/` (only with `--as-user`).

### Upgrading from 0.10 and earlier

Earlier versions kept one file per key in `data/storage`. On the first start the new version imports those values into `data/config.json` once (`meta.legacyImported`) and leaves the directory untouched. After checking `/status` or the config file you can delete `data/storage`. A `config.json` written by an earlier 1.x pre-release (version 1 with a single `telegramChatId`/`telegramTopicId` per group, or version 2 with a `telegramTargets` list per group) is upgraded to version 3 automatically; identical targets of different groups become one shared target.

## Development

```bash
npm test      # jest
npm run lint  # eslint
npm run debug # node --env-file=.env src/index.js --debug
```
