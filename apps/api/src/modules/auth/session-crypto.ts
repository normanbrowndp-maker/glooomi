import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

type Ciphertext = { ciphertext: string; iv: string; tag: string };

function key() {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('JWT_REFRESH_SECRET must be at least 32 bytes');
  return createHmac('sha256', secret).update('gloomi:refresh-session:v1').digest();
}

export function encryptRefreshToken(token: string): Ciphertext {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}

export function decryptRefreshToken(value: Ciphertext) {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
