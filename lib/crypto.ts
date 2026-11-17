import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function key() { return createHash('sha256').update(process.env.ENCRYPTION_SECRET || 'development-only-secret-change-me').digest() }
export function encryptCredentials(value: Record<string, string>) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}` }
export function decryptCredentials(value: string): Record<string, string> { const [iv, tag, encrypted] = value.split('.'); const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64')); decipher.setAuthTag(Buffer.from(tag, 'base64')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')) }
export function maskSecret(value?: string) { if (!value) return '••••••••'; return `${value.slice(0, 3)}••••••••${value.slice(-4)}` }
