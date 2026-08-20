import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const hex = config.credentialsEncryptionKey;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    const error = new Error('WordPress credential encryption is not configured');
    error.status = 503;
    throw error;
  }
  return Buffer.from(hex, 'hex');
}

export function encryptionConfigured() {
  return Boolean(config.credentialsEncryptionKey && /^[0-9a-fA-F]{64}$/.test(config.credentialsEncryptionKey));
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Cannot encrypt an empty secret');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

export function decryptSecret(payload) {
  if (!payload?.ciphertext || !payload?.iv || !payload?.tag) {
    throw new Error('Stored credential is unreadable');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
