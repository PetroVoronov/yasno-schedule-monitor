const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Store, deepMerge} = require('../src/modules/store/Store');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-store-'));
  return path.join(dir, 'nested', 'config.json');
}

describe('Store', () => {
  test('load() uses defaults when the file is missing and does not create it', () => {
    const store = new Store({filePath: tmpFile(), defaults: {a: {b: 1}}});
    expect(store.load()).toBe(false);
    expect(store.get(['a', 'b'])).toBe(1);
    expect(store.exists()).toBe(false);
  });

  test('set() persists atomically and load() reads it back merged with defaults', () => {
    const filePath = tmpFile();
    const store = new Store({filePath, defaults: {a: {b: 1, c: 2}, list: []}});
    store.set(['a', 'b'], 42);
    store.set(['groups', '1.1', 'calendarId'], 'cal');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith('.tmp'))).toHaveLength(0);

    const reloaded = new Store({filePath, defaults: {a: {b: 1, c: 2, d: 3}, list: []}});
    expect(reloaded.load()).toBe(true);
    expect(reloaded.get(['a', 'b'])).toBe(42);
    expect(reloaded.get(['a', 'c'])).toBe(2);
    expect(reloaded.get(['a', 'd'])).toBe(3);
    expect(reloaded.get(['groups', '1.1', 'calendarId'])).toBe('cal');
  });

  test('get() returns copies, fallback for missing values, and null/undefined removes keys', () => {
    const store = new Store({filePath: tmpFile(), defaults: {}});
    store.set('obj', {x: [1, 2]});
    const value = store.get('obj');
    value.x.push(3);
    expect(store.get('obj')).toEqual({x: [1, 2]});
    expect(store.get(['missing', 'deep'], 'fallback')).toBe('fallback');
    store.set('obj', null);
    expect(store.has('obj')).toBe(false);
  });

  test('update() applies several changes with one write', () => {
    const filePath = tmpFile();
    const store = new Store({filePath, defaults: {a: 1}});
    store.update((data) => {
      data.a = 2;
      data.b = 3;
    });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({a: 2, b: 3});
  });

  test('load() rejects invalid JSON with a clear error', () => {
    const filePath = tmpFile();
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.writeFileSync(filePath, '{not json');
    const store = new Store({filePath});
    expect(() => store.load()).toThrow(/not valid JSON/);
  });

  test('deepMerge replaces arrays and merges nested objects', () => {
    expect(deepMerge({a: {b: 1, c: [1]}, d: 1}, {a: {c: [2], e: 3}})).toEqual({a: {b: 1, c: [2], e: 3}, d: 1});
  });
});
