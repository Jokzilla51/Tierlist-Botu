const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 2;
const KITS = ['elytra', 'trap'];
const QUEUE_STATUSES = new Set(['open', 'paused', 'closed']);
const DEFAULT_QUEUE_CAPACITY = 25;
const DEFAULT_AVERAGE_TEST_MINUTES = 20;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const file = path.resolve(process.env.DATA_FILE || './data/state.json');
const saveListeners = new Set();
let temporaryFileSequence = 0;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSafeKey = (key) => !UNSAFE_KEYS.has(key);

function cloneJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item) ?? null);
  if (!isRecord(value)) return undefined;

  const cloned = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isSafeKey(key)) continue;
    const clonedItem = cloneJsonValue(item);
    if (clonedItem !== undefined) cloned[key] = clonedItem;
  }
  return cloned;
}

function synchronizeInPlace(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) {
    for (let index = 0; index < source.length; index += 1) {
      if (Array.isArray(target[index]) && Array.isArray(source[index])) {
        synchronizeInPlace(target[index], source[index]);
      } else if (isRecord(target[index]) && isRecord(source[index])) {
        synchronizeInPlace(target[index], source[index]);
      } else {
        target[index] = cloneJsonValue(source[index]);
      }
    }
    target.length = source.length;
    return target;
  }

  if (!isRecord(target) || !isRecord(source)) return cloneJsonValue(source);

  for (const key of Object.keys(target)) {
    if (!Object.hasOwn(source, key)) delete target[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(target[key]) && Array.isArray(value)) {
      synchronizeInPlace(target[key], value);
    } else if (isRecord(target[key]) && isRecord(value)) {
      synchronizeInPlace(target[key], value);
    } else {
      target[key] = cloneJsonValue(value);
    }
  }
  return target;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function nullableString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeRecordList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => cloneJsonValue(entry));
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))];
}

function normalizeQueue(value) {
  const source = isRecord(value) ? value : {};
  const testerId = nullableString(source.testerId);
  let status = QUEUE_STATUSES.has(source.status) ? source.status : (testerId ? 'open' : 'closed');

  // Eski kod yalnızca testerId alanını değiştiriyordu. Bu iki düzeltme hem o
  // davranışı korur hem de imkansız "açık ama testersız" durumları engeller.
  if (!testerId) status = 'closed';
  else if (status === 'closed') status = 'open';

  return {
    ...cloneJsonValue(source),
    status,
    capacity: nonNegativeInteger(source.capacity, DEFAULT_QUEUE_CAPACITY),
    averageTestMinutes: nonNegativeInteger(source.averageTestMinutes, DEFAULT_AVERAGE_TEST_MINUTES),
    testerId,
    entries: normalizeRecordList(source.entries),
    lastAnnouncementAt: nonNegativeInteger(source.lastAnnouncementAt)
  };
}

function normalizeQueues(value) {
  const source = isRecord(value) ? value : {};
  const queues = {};
  for (const kit of new Set([...KITS, ...Object.keys(source).filter(isSafeKey)])) {
    queues[kit] = normalizeQueue(source[kit]);
  }
  return queues;
}

function normalizeKitLists(value) {
  const source = isRecord(value) ? value : {};
  const result = {};
  for (const kit of new Set([...KITS, ...Object.keys(source).filter(isSafeKey)])) {
    result[kit] = normalizeRecordList(source[kit]);
  }
  return result;
}

function normalizeCooldowns(value) {
  const source = isRecord(value) ? value : {};
  const cooldowns = {};
  for (const kit of new Set([...KITS, ...Object.keys(source).filter(isSafeKey)])) {
    const savedKit = isRecord(source[kit]) ? source[kit] : {};
    cooldowns[kit] = {};
    for (const [userId, timestamp] of Object.entries(savedKit)) {
      if (!isSafeKey(userId) || !nullableString(userId)) continue;
      const normalizedTimestamp = nonNegativeInteger(timestamp, -1);
      if (normalizedTimestamp >= 0) cooldowns[kit][userId] = normalizedTimestamp;
    }
  }
  return cooldowns;
}

function normalizeRecordMap(value) {
  if (!isRecord(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isSafeKey(key) || !isRecord(entry)) continue;
    result[key] = cloneJsonValue(entry);
  }
  return result;
}

function normalizeTestBans(value) {
  if (Array.isArray(value)) {
    const bans = {};
    for (const ban of value) {
      const userId = isRecord(ban) ? nullableString(ban.userId) : null;
      if (userId && isSafeKey(userId)) bans[userId] = cloneJsonValue(ban);
    }
    return bans;
  }
  return normalizeRecordMap(value);
}

function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: { schemaVersion: SCHEMA_VERSION, createdAt: 0, updatedAt: 0 },
    serverAddress: null,
    queues: Object.fromEntries(KITS.map((kit) => [kit, normalizeQueue(null)])),
    activeTests: Object.fromEntries(KITS.map((kit) => [kit, []])),
    cooldowns: Object.fromEntries(KITS.map((kit) => [kit, {}])),
    notificationSubscribers: [],
    guildConfigs: {},
    testHistory: [],
    testerStats: {},
    testBans: {},
    auditLog: [],
    resultCorrections: []
  };
}

function parseExternalState(input) {
  if (Buffer.isBuffer(input)) return JSON.parse(input.toString('utf8'));
  if (typeof input === 'string') return JSON.parse(input);
  if (!isRecord(input)) throw new TypeError('Harici durum bir nesne, JSON metni veya Buffer olmalıdır.');
  return input;
}

function normalize(input) {
  const source = isRecord(input) ? input : {};
  const clonedSource = cloneJsonValue(source);
  const savedMetadata = isRecord(source.metadata) ? source.metadata : {};
  const legacyCreatedAt = source.createdAt;
  const legacyUpdatedAt = source.updatedAt;

  return {
    ...clonedSource,
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      ...cloneJsonValue(savedMetadata),
      schemaVersion: SCHEMA_VERSION,
      createdAt: nonNegativeInteger(savedMetadata.createdAt ?? legacyCreatedAt),
      updatedAt: nonNegativeInteger(savedMetadata.updatedAt ?? legacyUpdatedAt)
    },
    serverAddress: nullableString(source.serverAddress),
    queues: normalizeQueues(source.queues),
    activeTests: normalizeKitLists(source.activeTests),
    cooldowns: normalizeCooldowns(source.cooldowns),
    notificationSubscribers: normalizeStringList(source.notificationSubscribers),
    guildConfigs: normalizeRecordMap(source.guildConfigs),
    testHistory: normalizeRecordList(source.testHistory),
    testerStats: normalizeRecordMap(source.testerStats),
    testBans: normalizeTestBans(source.testBans),
    auditLog: normalizeRecordList(source.auditLog),
    resultCorrections: normalizeRecordList(source.resultCorrections)
  };
}

function load() {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Veri dosyası okunamadı:', error);
    return createInitialState();
  }
}

let state = load();

function writeAtomically(contents) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${temporaryFileSequence += 1}.tmp`
  );
  let descriptor;

  try {
    descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryFile, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}

function notifySaveListeners(json, source) {
  if (!saveListeners.size) return;
  const snapshot = JSON.parse(json);
  const metadata = {
    file,
    source,
    savedAt: snapshot.metadata.updatedAt,
    json
  };

  for (const listener of saveListeners) {
    try {
      const pending = listener(snapshot, metadata);
      if (pending && typeof pending.then === 'function') {
        pending.catch((error) => console.error('Kayıt dinleyicisi başarısız:', error));
      }
    } catch (error) {
      console.error('Kayıt dinleyicisi başarısız:', error);
    }
  }
}

function save(options = {}) {
  const source = isRecord(options) && typeof options.source === 'string' ? options.source : 'local';
  const normalized = normalize(state);
  const now = Math.max(Date.now(), normalized.metadata.updatedAt + 1);
  normalized.metadata.createdAt ||= now;
  normalized.metadata.updatedAt = now;
  synchronizeInPlace(state, normalized);

  const json = JSON.stringify(state, null, 2);
  writeAtomically(json);
  notifySaveListeners(json, source);
  return state;
}

function replace(input, options = {}) {
  const parsed = parseExternalState(input);
  const replacement = normalize(parsed);
  synchronizeInPlace(state, replacement);

  if (isRecord(options) && options.persist) {
    return save({ source: typeof options.source === 'string' ? options.source : 'replace' });
  }
  return state;
}

function restore(input, options = {}) {
  const restoreOptions = isRecord(options) ? options : {};
  return replace(input, {
    ...restoreOptions,
    persist: restoreOptions.persist !== false,
    source: typeof restoreOptions.source === 'string' ? restoreOptions.source : 'restore'
  });
}

function onSave(listener) {
  if (typeof listener !== 'function') throw new TypeError('Kayıt dinleyicisi bir fonksiyon olmalıdır.');
  saveListeners.add(listener);
  return () => saveListeners.delete(listener);
}

module.exports = {
  SCHEMA_VERSION,
  get: () => state,
  save,
  normalize,
  replace,
  restore,
  onSave,
  addSaveListener: onSave
};

