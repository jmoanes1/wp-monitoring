import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Centralized JSON file storage.
 *
 * All persistent reads/writes go through this module so concurrent
 * monitoring jobs cannot interleave partial JSON onto disk.
 *
 * Write path: queue lock → optional backup → stringify/validate →
 * write a unique temp file → rename into place (or copy on Windows).
 */

const locks = new Map();

function withLock(fileName, task) {
  const previous = locks.get(fileName) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  locks.set(fileName, current);
  return current;
}

function collectionPath(fileName) {
  return path.join(config.paths.dataDir, fileName);
}

function backupPath(fileName) {
  return path.join(config.paths.backupDir, `${fileName}.bak`);
}

async function ensureDirs() {
  await fs.mkdir(config.paths.dataDir, { recursive: true });
  await fs.mkdir(config.paths.backupDir, { recursive: true });
  await fs.mkdir(config.paths.logsDir, { recursive: true });
}

async function atomicWrite(filePath, data) {
  const serialized = JSON.stringify(data, null, 2);
  JSON.parse(serialized);

  const tmpPath = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmpPath, serialized, 'utf8');

  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    await fs.copyFile(tmpPath, filePath);
    await fs.unlink(tmpPath).catch(() => {});
  }
}

async function tryReadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function recoverCollection(fileName, fallback) {
  const bak = backupPath(fileName);
  try {
    const recovered = await tryReadJson(bak);
    logger.warn(`Recovered ${fileName} from backup after malformed JSON`);
    await atomicWrite(collectionPath(fileName), recovered);
    return recovered;
  } catch {
    logger.error(`Resetting ${fileName} after unrecoverable JSON`);
    await atomicWrite(collectionPath(fileName), fallback);
    return fallback;
  }
}

async function readRaw(fileName, fallback) {
  await ensureDirs();
  const filePath = collectionPath(fileName);

  try {
    return await tryReadJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await atomicWrite(filePath, fallback);
      return fallback;
    }
    if (error instanceof SyntaxError) {
      return recoverCollection(fileName, fallback);
    }
    throw error;
  }
}

async function writeRaw(fileName, data) {
  await ensureDirs();
  const filePath = collectionPath(fileName);

  try {
    await fs.copyFile(filePath, backupPath(fileName));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Could not backup ${fileName}: ${error.message}`);
    }
  }

  await atomicWrite(filePath, data);
  return data;
}

export async function readCollection(fileName) {
  return withLock(fileName, async () => {
    const data = await readRaw(fileName, []);
    return Array.isArray(data) ? data : [];
  });
}

export async function writeCollection(fileName, data) {
  if (!Array.isArray(data)) {
    throw new Error(`Collection ${fileName} must be an array`);
  }
  return withLock(fileName, () => writeRaw(fileName, data));
}

export async function readDocument(fileName, fallback = {}) {
  return withLock(fileName, async () => {
    const data = await readRaw(fileName, fallback);
    return data && !Array.isArray(data) ? data : fallback;
  });
}

export async function writeDocument(fileName, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Document ${fileName} must be an object`);
  }
  return withLock(fileName, () => writeRaw(fileName, data));
}

export async function findOne(fileName, predicate) {
  const items = await readCollection(fileName);
  return items.find(predicate) || null;
}

export async function findMany(fileName, predicate = () => true) {
  const items = await readCollection(fileName);
  return items.filter(predicate);
}

export async function insert(fileName, item) {
  return withLock(fileName, async () => {
    const items = await readRaw(fileName, []);
    const collection = Array.isArray(items) ? items : [];
    collection.push(item);
    await writeRaw(fileName, collection);
    return item;
  });
}

export async function update(fileName, id, changes) {
  return withLock(fileName, async () => {
    const items = await readRaw(fileName, []);
    const collection = Array.isArray(items) ? items : [];
    const index = collection.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated = {
      ...collection[index],
      ...changes,
      id: collection[index].id
    };
    collection[index] = updated;
    await writeRaw(fileName, collection);
    return updated;
  });
}

export async function remove(fileName, id) {
  return withLock(fileName, async () => {
    const items = await readRaw(fileName, []);
    const collection = Array.isArray(items) ? items : [];
    const index = collection.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const [deleted] = collection.splice(index, 1);
    await writeRaw(fileName, collection);
    return deleted;
  });
}

export async function mutateCollection(fileName, mutator) {
  return withLock(fileName, async () => {
    const items = await readRaw(fileName, []);
    const collection = Array.isArray(items) ? items : [];
    const result = await mutator(collection);
    await writeRaw(fileName, collection);
    return result;
  });
}

export async function initializeStorage(defaults) {
  await ensureDirs();
  for (const [fileName, fallback] of Object.entries(defaults.collections)) {
    await readCollection(fileName);
    const existing = await readRaw(fileName, fallback);
    if (!Array.isArray(existing)) {
      await writeRaw(fileName, fallback);
    }
  }
  for (const [fileName, fallback] of Object.entries(defaults.documents)) {
    const existing = await readDocument(fileName, fallback);
    await writeDocument(fileName, { ...fallback, ...existing, emailEnabled: false });
  }
}

export const storage = {
  readCollection,
  writeCollection,
  readDocument,
  writeDocument,
  findOne,
  findMany,
  insert,
  update,
  remove,
  mutateCollection,
  initializeStorage
};

export default storage;
