/** @module store/Store **/

const fs = require('node:fs');
const path = require('node:path');

/**
 * Deep clone plain JSON data.
 * @param {any} value
 * @returns {any}
 */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge `source` over `target`. Arrays and scalars from `source` replace the target value.
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function deepMerge(target, source) {
  const result = isPlainObject(target) ? {...target} : {};
  if (!isPlainObject(source)) {
    return result;
  }
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

/**
 * Single-document JSON store persisted atomically to one file.
 *
 * The document is kept in memory, every mutation is written to disk immediately via
 * a temporary file + rename, so a crash never leaves a half-written config behind.
 */
class Store {
  #filePath;
  #defaults;
  #data;
  #logger;
  #fileMode;

  /**
   * @param {object} params
   * @param {string} params.filePath - Path to the JSON document.
   * @param {object} [params.defaults] - Default document shape, merged under loaded data.
   * @param {object} [params.logger] - Logger with debug/info/warn/error methods.
   * @param {number} [params.fileMode] - File mode for the document (default 0o600).
   */
  constructor({filePath, defaults = {}, logger = null, fileMode = 0o600}) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('Store requires a filePath');
    }
    this.#filePath = filePath;
    this.#defaults = clone(defaults);
    this.#logger = logger;
    this.#fileMode = fileMode;
    this.#data = clone(this.#defaults);
  }

  get filePath() {
    return this.#filePath;
  }

  /** Whether the backing file exists on disk. */
  exists() {
    return fs.existsSync(this.#filePath);
  }

  /**
   * Load the document from disk. Missing file results in defaults.
   * @returns {boolean} true when a file was loaded, false when defaults were used.
   */
  load() {
    if (!fs.existsSync(this.#filePath)) {
      this.#data = clone(this.#defaults);
      return false;
    }
    const raw = fs.readFileSync(this.#filePath, 'utf8');
    let parsed;
    try {
      parsed = raw.trim().length > 0 ? JSON.parse(raw) : {};
    } catch (error) {
      throw new Error(`Store file ${this.#filePath} is not valid JSON: ${error.message}`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error(`Store file ${this.#filePath} must contain a JSON object`);
    }
    this.#data = deepMerge(this.#defaults, parsed);
    return true;
  }

  /** Persist the document atomically. */
  save() {
    const dir = path.dirname(this.#filePath);
    fs.mkdirSync(dir, {recursive: true});
    const tmpPath = `${this.#filePath}.${process.pid}.tmp`;
    const content = JSON.stringify(this.#data, null, 2) + '\n';
    fs.writeFileSync(tmpPath, content, {encoding: 'utf8', mode: this.#fileMode});
    fs.renameSync(tmpPath, this.#filePath);
    try {
      fs.chmodSync(this.#filePath, this.#fileMode);
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (error) {
      // chmod can fail on some mounted filesystems (e.g. Windows bind mounts); the file is still written.
    }
    this.#logger?.debug?.(`Store] [Saved ${this.#filePath}`);
  }

  /** A deep copy of the whole document. */
  snapshot() {
    return clone(this.#data);
  }

  /**
   * Normalise a path argument into an array of keys.
   * @param {string|string[]} keyPath
   * @returns {string[]}
   */
  static normalizePath(keyPath) {
    if (Array.isArray(keyPath)) {
      return keyPath.map(String);
    }
    if (typeof keyPath === 'string' && keyPath.length > 0) {
      return [keyPath];
    }
    throw new TypeError('Store path must be a non-empty string or an array of keys');
  }

  /**
   * Read a value.
   * @param {string|string[]} keyPath
   * @param {any} [fallback] - Returned when the value is undefined or null.
   * @returns {any} A deep copy of the stored value.
   */
  get(keyPath, fallback = null) {
    const keys = Store.normalizePath(keyPath);
    let current = this.#data;
    for (const key of keys) {
      if (!isPlainObject(current) || !Object.hasOwn(current, key)) {
        return fallback;
      }
      current = current[key];
    }
    if (current === undefined || current === null) {
      return fallback;
    }
    return clone(current);
  }

  /** Whether a non-null value is stored under the path. */
  has(keyPath) {
    const missing = Symbol('missing');
    return this.get(keyPath, missing) !== missing;
  }

  /**
   * Write a value and persist. Intermediate objects are created as needed.
   * @param {string|string[]} keyPath
   * @param {any} value - `undefined` or `null` removes the key.
   */
  set(keyPath, value) {
    if (value === undefined || value === null) {
      this.unset(keyPath);
      return;
    }
    const keys = Store.normalizePath(keyPath);
    let current = this.#data;
    for (const key of keys.slice(0, -1)) {
      if (!isPlainObject(current[key])) {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys.at(-1)] = clone(value);
    this.save();
  }

  /**
   * Remove a key and persist.
   * @param {string|string[]} keyPath
   */
  unset(keyPath) {
    const keys = Store.normalizePath(keyPath);
    let current = this.#data;
    for (const key of keys.slice(0, -1)) {
      if (!isPlainObject(current[key])) {
        return;
      }
      current = current[key];
    }
    if (Object.hasOwn(current, keys.at(-1))) {
      delete current[keys.at(-1)];
      this.save();
    }
  }

  /**
   * Apply several changes with a single write.
   * @param {(data: object) => void} mutator - Receives the live document.
   */
  update(mutator) {
    mutator(this.#data);
    this.save();
  }
}

module.exports = {
  Store,
  deepMerge,
};
