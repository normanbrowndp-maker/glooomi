import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export type EmailPayload = { to: string; code: string };
export type EncryptedPayload = { ciphertext: string; iv: string; tag: string };

function key() {
  const pepper = process.env.EMAIL_CODE_PEPPER;
  if (!pepper || Buffer.byteLength(pepper) < 32) throw new Error('EMAIL_CODE_PEPPER must be at least 32 bytes');
  return createHmac('sha256', pepper).update('gloomi:email-outbox:v1').digest();
}

export function encryptEmailPayload(payload: EmailPayload): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}

export function decryptEmailPayload(payload: EncryptedPayload): EmailPayload {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(payload.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64url')), decipher.final()]).toString('utf8')) as EmailPayload;
}
