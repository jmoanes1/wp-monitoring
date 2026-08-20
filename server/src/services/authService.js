import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso } from '../utils/time.js';
import { logger } from '../utils/logger.js';

const USERS = config.files.users;

export async function ensureDefaultAdmin() {
  const users = await storage.readCollection(USERS);
  if (users.length > 0) return;

  const passwordHash = await bcrypt.hash(config.defaultAdminPassword, 12);
  await storage.insert(USERS, {
    id: createId('user'),
    username: config.defaultAdminUsername,
    passwordHash,
    role: 'admin',
    createdAt: nowIso()
  });
  logger.info(`Created default admin user "${config.defaultAdminUsername}"`);
}

export async function authenticateUser(username, password) {
  const user = await storage.findOne(
    USERS,
    (item) => item.username.toLowerCase() === String(username).toLowerCase()
  );
  if (!user) return null;

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) return null;

  return publicUser(user);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export async function getUserById(id) {
  const user = await storage.findOne(USERS, (item) => item.id === id);
  return user ? publicUser(user) : null;
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await storage.findOne(USERS, (item) => item.id === userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw Object.assign(new Error('Current password is incorrect'), { status: 400 });

  if (!newPassword || newPassword.length < 8) {
    throw Object.assign(new Error('New password must be at least 8 characters'), { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await storage.update(USERS, userId, { passwordHash, updatedAt: nowIso() });
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
}
