/** @module config/settings
 *
 * Domain layer on top of the generic Store: knows the document shape, the group model,
 * how `.env` seeds empty fields and how the legacy `data/storage` directory is imported.
 **/

const fs = require('node:fs');
const path = require('node:path');
const {Store} = require('../store/Store');

/** Group ids as used by Yasno: "<group>.<subgroup>", e.g. "1.1" or "60.1". */
const GROUP_ID_PATTERN = /^\d{1,3}\.\d{1,2}$/;
const GROUP_FIELDS = ['calendarId', 'svitlobotChannelIds'];
/** Telegram target kinds, as in telegram-forward-user-bot. */
const TARGET_TYPES = ['user', 'bot', 'group', 'channel', 'topic'];
const CONFIG_VERSION = 2;
const PERSISTED_OPTIONS = ['scheduleUpdateInterval', 'pinMessage', 'unpinPrevious', 'ignoreStatus', 'debug'];
const BOT_TOKEN_MIN_LENGTH = 43;

const DEFAULT_DOCUMENT = {
  version: CONFIG_VERSION,
  telegram: {
    botToken: null,
    managementBotToken: null,
    apiId: null,
    apiHash: null,
    adminIds: [],
  },
  options: {},
  groups: {},
  state: {
    lastMessageIds: {},
    knownYasnoStatuses: {},
    yasnoGroupIds: [],
  },
  meta: {
    legacyImported: false,
  },
};

/**
 * Normalise a user-supplied group id ("7", "7.1", "7_1", "7-1") into canonical "X.Y" form.
 * A bare group number means subgroup 1.
 * @returns {string|null}
 */
function normalizeGroupId(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim().replace(/[_-]/g, '.');
  const candidate = /^\d{1,3}$/.test(text) ? `${text}.1` : text;
  if (!GROUP_ID_PATTERN.test(candidate)) {
    return null;
  }
  const [group, subGroup] = candidate.split('.').map(Number);
  return group > 0 && subGroup > 0 ? `${group}.${subGroup}` : null;
}

/** Numeric ordering of group ids: 2.1 < 10.1, 1.1 < 1.2. */
function compareGroupIds(a, b) {
  const [ga, sa] = a.split('.').map(Number);
  const [gb, sb] = b.split('.').map(Number);
  return ga - gb || sa - sb;
}

function normalizeGroupIdList(ids) {
  const list = Array.isArray(ids) ? ids : [];
  return [...new Set(list.map(normalizeGroupId).filter((id) => id !== null))].sort(compareGroupIds);
}

function parseAdminIds(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => Number.parseInt(item, 10)).filter((id) => Number.isInteger(id) && id > 0))];
  }
  if (typeof value !== 'string') {
    return [];
  }
  return parseAdminIds(value.split(/[\s,;]+/));
}

function parseChannelIds(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0))];
  }
  if (typeof value !== 'string') {
    return [];
  }
  return parseChannelIds(value.split(','));
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function emptyGroup() {
  return {calendarId: null, telegramTargets: [], svitlobotChannelIds: []};
}

/** Guess the target type from the ids when it was not given (legacy data, env). */
function inferTargetType(chatId, topicId) {
  if (Number.isInteger(topicId) && topicId > 0) {
    return 'topic';
  }
  return chatId > 0 ? 'user' : 'group';
}

/**
 * Validate and normalise a Telegram target.
 * @param {object} input - {type?, chatId, topicId?, label?, enabled?}
 * @returns {{type: string, chatId: number, topicId: number|null, label: string|null, enabled: boolean}}
 */
function normalizeTarget(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Telegram target must be an object');
  }
  const chatId = parseInteger(input.chatId);
  if (chatId === null || chatId === 0) {
    throw new Error('Telegram chat id must be a non-zero integer');
  }
  let topicId = input.topicId === undefined || input.topicId === null || input.topicId === '' ? null : parseInteger(input.topicId);
  if (topicId !== null && topicId < 0) {
    throw new Error('Telegram topic id must be a non-negative integer');
  }
  if (topicId === 0) {
    topicId = null;
  }
  let type = typeof input.type === 'string' && input.type.length > 0 ? input.type.toLowerCase() : inferTargetType(chatId, topicId);
  if (!TARGET_TYPES.includes(type)) {
    throw new Error(`Unknown target type: ${input.type}. Use one of ${TARGET_TYPES.join(', ')}`);
  }
  if (type === 'topic' && topicId === null) {
    throw new Error('A topic target needs a topic id');
  }
  if (type !== 'topic' && topicId !== null) {
    type = 'topic';
  }
  const label = typeof input.label === 'string' && input.label.trim().length > 0 ? input.label.trim().slice(0, 64) : null;
  const enabled = input.enabled === undefined || input.enabled === null ? true : Boolean(input.enabled);
  return {type, chatId, topicId, label, enabled};
}

/** Stable key of a target inside a group: "<chatId>:<topicId or 0>". */
function targetKey(target) {
  return `${target.chatId}:${target.topicId ?? 0}`;
}

/**
 * Parse "<chatId>[/<topicId>]" as typed by a user or given in env.
 * @returns {{chatId: number, topicId: number|null}|null}
 */
function parseTargetRef(value) {
  const text = String(value ?? '').trim();
  const match = /^(-?\d+)(?:[/:](\d+))?$/.exec(text);
  if (!match) {
    return null;
  }
  const topicId = match[2] === undefined ? null : Number.parseInt(match[2], 10);
  return {chatId: Number.parseInt(match[1], 10), topicId: topicId === 0 ? null : topicId};
}

class Settings {
  /** @type {Store} */
  store;
  #logger;

  constructor({filePath, logger = null}) {
    this.#logger = logger;
    this.store = new Store({filePath, defaults: DEFAULT_DOCUMENT, logger});
  }

  get filePath() {
    return this.store.filePath;
  }

  /**
   * Load the document, importing a legacy node-localstorage directory on first run.
   * @param {object} [params]
   * @param {string} [params.legacyDir] - Directory used by the previous node-localstorage based storage.
   * @returns {{loaded: boolean, imported: number}}
   */
  init({legacyDir = null} = {}) {
    const loaded = this.store.load();
    let imported = 0;
    if (legacyDir && !this.store.get(['meta', 'legacyImported'], false) && fs.existsSync(legacyDir)) {
      imported = this.importLegacyStorage(legacyDir);
      this.store.set(['meta', 'legacyImported'], true);
      this.#logger?.info?.(`Imported ${imported} value(s) from legacy storage at ${legacyDir}. The directory can be removed.`);
    } else if (!loaded) {
      this.store.save();
    }
    this.migrate();
    return {loaded, imported};
  }

  /**
   * Upgrade older document layouts in place.
   * v1 -> v2: group.telegramChatId/telegramTopicId become group.telegramTargets[], and
   * state.lastMessageIds is keyed by "<group>|<chatId>:<topicId>" instead of "<group>".
   */
  migrate() {
    const version = this.store.get('version', 1);
    if (version >= CONFIG_VERSION) {
      return false;
    }
    this.store.update((data) => {
      data.groups = data.groups || {};
      data.state = data.state || {};
      data.state.lastMessageIds = data.state.lastMessageIds || {};
      for (const [groupId, group] of Object.entries(data.groups)) {
        if (!group || typeof group !== 'object') {
          continue;
        }
        const chatId = parseInteger(group.telegramChatId);
        const topicId = parseInteger(group.telegramTopicId);
        group.telegramTargets = Array.isArray(group.telegramTargets) ? group.telegramTargets : [];
        if (chatId !== null && chatId !== 0) {
          try {
            const target = normalizeTarget({chatId, topicId});
            if (!group.telegramTargets.some((item) => targetKey(item) === targetKey(target))) {
              group.telegramTargets.push(target);
            }
            const lastMessageId = parseInteger(data.state.lastMessageIds[groupId]);
            if (lastMessageId !== null) {
              data.state.lastMessageIds[`${groupId}|${targetKey(target)}`] = lastMessageId;
            }
          } catch (error) {
            this.#logger?.warn?.(`Group ${groupId}: telegram target not migrated: ${error.message}`);
          }
        }
        delete data.state.lastMessageIds[groupId];
        delete group.telegramChatId;
        delete group.telegramTopicId;
      }
      data.version = CONFIG_VERSION;
    });
    this.#logger?.info?.(`Configuration upgraded to version ${CONFIG_VERSION}.`);
    return true;
  }

  // ---------- groups ----------

  /** Canonical ids of every group that has a calendar configured, in numeric order. */
  configuredGroupIds() {
    const groups = this.store.get('groups', {});
    return Object.keys(groups)
      .filter((id) => typeof groups[id]?.calendarId === 'string' && groups[id].calendarId.length > 0)
      .sort(compareGroupIds);
  }

  /** Ids of every group that has at least one field set, in numeric order. */
  knownGroupIds() {
    return Object.keys(this.store.get('groups', {})).sort(compareGroupIds);
  }

  /** Group ids last seen in the Yasno payload (empty until the first successful fetch). */
  getYasnoGroupIds() {
    return normalizeGroupIdList(this.store.get(['state', 'yasnoGroupIds'], []));
  }

  /**
   * Remember the group ids returned by Yasno.
   * @param {string[]} ids
   * @returns {boolean} true when the stored list changed.
   */
  setYasnoGroupIds(ids) {
    const normalized = normalizeGroupIdList(ids);
    if (normalized.length === 0 || JSON.stringify(normalized) === JSON.stringify(this.getYasnoGroupIds())) {
      return false;
    }
    this.store.set(['state', 'yasnoGroupIds'], normalized);
    return true;
  }

  /**
   * Validate a group id against the list of groups known from Yasno (when that list is available).
   * @returns {string} The canonical id.
   */
  assertYasnoGroupId(groupId) {
    const id = normalizeGroupId(groupId);
    if (id === null) {
      throw new Error(`Invalid group id: ${groupId}`);
    }
    const known = this.getYasnoGroupIds();
    if (known.length > 0 && !known.includes(id)) {
      throw new Error(`Unknown Yasno group ${id}. Known groups: ${known.join(', ')}`);
    }
    return id;
  }

  getGroup(groupId) {
    const id = normalizeGroupId(groupId);
    if (id === null) {
      return null;
    }
    const group = {...emptyGroup(), ...this.store.get(['groups', id], {})};
    group.telegramTargets = Array.isArray(group.telegramTargets) ? group.telegramTargets : [];
    return group;
  }

  #saveGroup(id, group) {
    const isEmpty = group.calendarId === null && group.telegramTargets.length === 0 && group.svitlobotChannelIds.length === 0;
    if (isEmpty) {
      this.store.unset(['groups', id]);
    } else {
      this.store.set(['groups', id], group);
    }
    return group;
  }

  // ---------- telegram targets ----------

  listTargets(groupId) {
    return this.getGroup(groupId)?.telegramTargets ?? [];
  }

  findTarget(groupId, key) {
    return this.listTargets(groupId).find((target) => targetKey(target) === key) ?? null;
  }

  /**
   * Add a Telegram target to a group.
   * @returns {object} The normalised target.
   */
  addTarget(groupId, input) {
    const id = this.assertYasnoGroupId(groupId);
    const target = normalizeTarget(input);
    const group = this.getGroup(id);
    if (group.telegramTargets.some((item) => targetKey(item) === targetKey(target))) {
      throw new Error(`Target ${targetKey(target)} already exists in group ${id}`);
    }
    group.telegramTargets.push(target);
    this.#saveGroup(id, group);
    return target;
  }

  /**
   * Change label/enabled/type of an existing target (ids are immutable; remove and add instead).
   */
  updateTarget(groupId, key, patch) {
    const id = normalizeGroupId(groupId);
    if (id === null) {
      throw new Error(`Invalid group id: ${groupId}`);
    }
    const group = this.getGroup(id);
    const index = group.telegramTargets.findIndex((item) => targetKey(item) === key);
    if (index === -1) {
      throw new Error(`Target ${key} not found in group ${id}`);
    }
    const current = group.telegramTargets[index];
    const next = normalizeTarget({...current, ...patch, chatId: current.chatId, topicId: current.topicId});
    group.telegramTargets[index] = next;
    this.#saveGroup(id, group);
    return next;
  }

  removeTarget(groupId, key) {
    const id = normalizeGroupId(groupId);
    if (id === null) {
      throw new Error(`Invalid group id: ${groupId}`);
    }
    const group = this.getGroup(id);
    const before = group.telegramTargets.length;
    group.telegramTargets = group.telegramTargets.filter((item) => targetKey(item) !== key);
    if (group.telegramTargets.length === before) {
      throw new Error(`Target ${key} not found in group ${id}`);
    }
    this.store.unset(['state', 'lastMessageIds', `${id}|${key}`]);
    return this.#saveGroup(id, group);
  }

  /**
   * Set one group field. Values are validated and coerced.
   * @param {string} groupId
   * @param {'calendarId'|'svitlobotChannelIds'} field
   * @param {any} value
   * @returns {object} The updated group record.
   */
  setGroupField(groupId, field, value) {
    const id = this.assertYasnoGroupId(groupId);
    if (!GROUP_FIELDS.includes(field)) {
      throw new Error(`Unknown group field: ${field}`);
    }
    let coerced;
    switch (field) {
      case 'calendarId': {
        coerced = typeof value === 'string' ? value.trim() : '';
        if (coerced.length === 0) {
          throw new Error('Calendar id must be a non-empty string');
        }
        break;
      }
      case 'svitlobotChannelIds': {
        coerced = parseChannelIds(value);
        if (coerced.length === 0) {
          throw new Error('At least one svitlobot channel id is required');
        }
        break;
      }
      default:
        coerced = value;
    }
    const current = this.getGroup(id);
    current[field] = coerced;
    return this.#saveGroup(id, current);
  }

  unsetGroupField(groupId, field) {
    const id = normalizeGroupId(groupId);
    if (id === null) {
      throw new Error(`Invalid group id: ${groupId}`);
    }
    if (!GROUP_FIELDS.includes(field)) {
      throw new Error(`Unknown group field: ${field}`);
    }
    const current = this.getGroup(id);
    current[field] = field === 'svitlobotChannelIds' ? [] : null;
    return this.#saveGroup(id, current);
  }

  removeGroup(groupId) {
    const id = normalizeGroupId(groupId);
    if (id === null) {
      throw new Error(`Invalid group id: ${groupId}`);
    }
    this.store.unset(['groups', id]);
  }

  // ---------- runtime state ----------

  getLastMessageId(groupId, key) {
    return this.store.get(['state', 'lastMessageIds', `${groupId}|${key}`], null);
  }

  setLastMessageId(groupId, key, messageId) {
    this.store.set(['state', 'lastMessageIds', `${groupId}|${key}`], messageId);
  }

  getKnownYasnoStatuses() {
    return this.store.get(['state', 'knownYasnoStatuses'], {});
  }

  addKnownYasnoStatus(status, sample) {
    this.store.set(['state', 'knownYasnoStatuses', status], sample);
  }

  // ---------- options ----------

  getOption(name) {
    return this.store.get(['options', name], null);
  }

  setOption(name, value) {
    if (!PERSISTED_OPTIONS.includes(name)) {
      throw new Error(`Option ${name} cannot be persisted`);
    }
    this.store.set(['options', name], value);
  }

  clearOption(name) {
    this.store.unset(['options', name]);
  }

  // ---------- telegram ----------

  getAdminIds() {
    return parseAdminIds(this.store.get(['telegram', 'adminIds'], []));
  }

  setAdminIds(ids) {
    this.store.set(['telegram', 'adminIds'], parseAdminIds(ids));
  }

  getBotToken() {
    const token = this.store.get(['telegram', 'botToken'], null);
    return typeof token === 'string' && token.length >= BOT_TOKEN_MIN_LENGTH ? token : null;
  }

  setBotToken(token) {
    this.store.set(['telegram', 'botToken'], token);
  }

  getManagementBotToken() {
    const token = this.store.get(['telegram', 'managementBotToken'], null);
    return typeof token === 'string' && token.length >= BOT_TOKEN_MIN_LENGTH ? token : null;
  }

  getApiCredentials() {
    const apiId = this.store.get(['telegram', 'apiId'], null);
    const apiHash = this.store.get(['telegram', 'apiHash'], null);
    if (Number.isInteger(apiId) && apiId > 0 && typeof apiHash === 'string' && apiHash.length > 0) {
      return {apiId, apiHash};
    }
    return null;
  }

  setApiCredentials({apiId, apiHash}) {
    this.store.update((data) => {
      data.telegram.apiId = apiId;
      data.telegram.apiHash = apiHash;
    });
  }

  // ---------- environment seeding ----------

  /**
   * Seed empty fields from environment variables. A stored value always wins; when the
   * environment holds a different value a warning is logged so the operator knows the
   * `.env` entry is stale.
   * @param {NodeJS.ProcessEnv} env
   * @returns {string[]} Names of the environment variables that were applied.
   */
  seedFromEnv(env = process.env) {
    const applied = [];
    const warn = (name) => this.#logger?.warn?.(`Environment variable ${name} differs from the stored value; the stored value is used.`);
    const seed = (name, isEmpty, apply, equals) => {
      const raw = env[name];
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        return;
      }
      if (isEmpty()) {
        try {
          apply(raw.trim());
          applied.push(name);
        } catch (error) {
          this.#logger?.warn?.(`Environment variable ${name} is ignored: ${error.message}`);
        }
      } else if (!equals(raw.trim())) {
        warn(name);
      }
    };

    seed(
      'TELEGRAM_BOT_AUTH_TOKEN',
      () => this.getBotToken() === null,
      (value) => this.setBotToken(value),
      (value) => this.getBotToken() === value,
    );
    seed(
      'TELEGRAM_MANAGEMENT_BOT_TOKEN',
      () => this.getManagementBotToken() === null,
      (value) => this.store.set(['telegram', 'managementBotToken'], value),
      (value) => this.getManagementBotToken() === value,
    );
    seed(
      'TELEGRAM_ADMIN_IDS',
      () => this.getAdminIds().length === 0,
      (value) => this.setAdminIds(value),
      (value) => JSON.stringify(parseAdminIds(value)) === JSON.stringify(this.getAdminIds()),
    );
    seed(
      'TELEGRAM_API_ID',
      () => !Number.isInteger(this.store.get(['telegram', 'apiId'], null)),
      (value) => this.store.set(['telegram', 'apiId'], parseInteger(value)),
      (value) => this.store.get(['telegram', 'apiId'], null) === parseInteger(value),
    );
    seed(
      'TELEGRAM_API_HASH',
      () => typeof this.store.get(['telegram', 'apiHash'], null) !== 'string',
      (value) => this.store.set(['telegram', 'apiHash'], value),
      (value) => this.store.get(['telegram', 'apiHash'], null) === value,
    );

    // Telegram targets: TELEGRAM_CHAT_ID_GROUP_<g>_<s>="<chatId>[/<topicId>][,<chatId>[/<topicId>]...]"
    // plus the legacy TELEGRAM_TOPIC_ID_GROUP_<g>_<s> that applies to the first chat id.
    const chatPrefix = 'TELEGRAM_CHAT_ID_GROUP_';
    const topicPrefix = 'TELEGRAM_TOPIC_ID_GROUP_';
    for (const name of Object.keys(env)) {
      if (!name.startsWith(chatPrefix)) {
        continue;
      }
      const suffix = name.slice(chatPrefix.length);
      const groupId = normalizeGroupId(suffix.replace(/_+/g, '.'));
      if (groupId === null) {
        this.#logger?.warn?.(`Environment variable ${name} does not match a known group id and is ignored.`);
        continue;
      }
      const refs = String(env[name])
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map(parseTargetRef);
      if (refs.length === 0 || refs.some((ref) => ref === null)) {
        this.#logger?.warn?.(`Environment variable ${name} is ignored: expected "<chatId>[/<topicId>]" entries.`);
        continue;
      }
      const legacyTopic = parseInteger(env[`${topicPrefix}${suffix}`]);
      if (legacyTopic !== null && legacyTopic > 0 && refs[0].topicId === null) {
        refs[0].topicId = legacyTopic;
      }
      const wanted = refs.map((ref) => normalizeTarget(ref));
      seed(
        name,
        () => this.listTargets(groupId).length === 0,
        () => {
          for (const target of wanted) {
            this.addTarget(groupId, target);
          }
        },
        () => {
          const current = this.listTargets(groupId).map(targetKey);
          return wanted.every((target) => current.includes(targetKey(target)));
        },
      );
    }

    const fieldByPrefix = {
      CALENDAR_ID_GROUP_: 'calendarId',
      SVITLOBOT_CHANNEL_ID_GROUP_: 'svitlobotChannelIds',
    };
    for (const [prefix, field] of Object.entries(fieldByPrefix)) {
      for (const name of Object.keys(env)) {
        if (!name.startsWith(prefix)) {
          continue;
        }
        const groupId = normalizeGroupId(name.slice(prefix.length).replace(/_+/g, '.'));
        if (groupId === null) {
          this.#logger?.warn?.(`Environment variable ${name} does not match a known group id and is ignored.`);
          continue;
        }
        seed(
          name,
          () => {
            const group = this.getGroup(groupId);
            return field === 'svitlobotChannelIds' ? group.svitlobotChannelIds.length === 0 : group[field] === null;
          },
          (value) => this.setGroupField(groupId, field, value),
          (value) => {
            const group = this.getGroup(groupId);
            if (field === 'svitlobotChannelIds') {
              return JSON.stringify(parseChannelIds(value)) === JSON.stringify(group.svitlobotChannelIds);
            }
            return group.calendarId === value;
          },
        );
      }
    }
    return applied;
  }

  // ---------- legacy import ----------

  /**
   * Import values from the node-localstorage directory used before version 0.11.
   * Files are left untouched.
   * @param {string} dir
   * @returns {number} Count of imported values.
   */
  importLegacyStorage(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch (error) {
      this.#logger?.warn?.(`Unable to read legacy storage directory ${dir}: ${error.message}`);
      return 0;
    }
    const legacy = {};
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      let key;
      try {
        key = decodeURIComponent(entry.name);
        // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (error) {
        key = entry.name;
      }
      const raw = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      try {
        legacy[key] = JSON.parse(raw);
        // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (error) {
        legacy[key] = raw;
      }
    }
    return this.importLegacyValues(legacy);
  }

  /**
   * Import a flat key/value map in the legacy naming scheme.
   * @param {Record<string, any>} legacy
   * @returns {number}
   */
  importLegacyValues(legacy) {
    let imported = 0;
    this.store.update((data) => {
      data.version = 1; // legacy values use the v1 layout; migrate() upgrades them afterwards
    });
    const groupKey = /^(calendarId|telegramChatId|telegramTopicId|svitlobotChannelId|lastMessageId)Group(.+)$/;
    this.store.update((data) => {
      for (const [key, value] of Object.entries(legacy)) {
        if (value === null || value === undefined || value === '') {
          continue;
        }
        const match = groupKey.exec(key);
        if (match) {
          const groupId = normalizeGroupId(match[2]);
          if (groupId === null) {
            this.#logger?.warn?.(`Legacy key ${key} does not match a known group id and is skipped.`);
            continue;
          }
          const field = match[1];
          if (field === 'lastMessageId') {
            const id = parseInteger(value);
            if (id !== null) {
              data.state.lastMessageIds[groupId] = id;
              imported++;
            }
            continue;
          }
          data.groups[groupId] = {calendarId: null, telegramChatId: null, telegramTopicId: null, svitlobotChannelIds: [], ...(data.groups[groupId] || {})};
          if (field === 'svitlobotChannelId') {
            const ids = parseChannelIds(value);
            if (ids.length > 0) {
              data.groups[groupId].svitlobotChannelIds = ids;
              imported++;
            }
          } else if (field === 'calendarId') {
            data.groups[groupId].calendarId = String(value);
            imported++;
          } else {
            const id = parseInteger(value);
            if (id !== null) {
              data.groups[groupId][field] = id;
              imported++;
            }
          }
          continue;
        }
        switch (key) {
          case 'telegramBotAuthToken':
            data.telegram.botToken = String(value);
            imported++;
            break;
          case 'telegramApiId':
            data.telegram.apiId = parseInteger(value);
            imported++;
            break;
          case 'telegramApiHash':
            data.telegram.apiHash = String(value);
            imported++;
            break;
          case 'knownYasnoStatuses':
            if (value && typeof value === 'object') {
              data.state.knownYasnoStatuses = {...data.state.knownYasnoStatuses, ...value};
              imported++;
            }
            break;
          default:
            this.#logger?.debug?.(`Legacy key ${key} is not known and is skipped.`);
        }
      }
    });
    return imported;
  }
}

module.exports = {
  Settings,
  DEFAULT_DOCUMENT,
  GROUP_FIELDS,
  GROUP_ID_PATTERN,
  TARGET_TYPES,
  CONFIG_VERSION,
  normalizeTarget,
  targetKey,
  parseTargetRef,
  inferTargetType,
  PERSISTED_OPTIONS,
  BOT_TOKEN_MIN_LENGTH,
  normalizeGroupId,
  compareGroupIds,
  normalizeGroupIdList,
  parseAdminIds,
  parseChannelIds,
  parseInteger,
};
