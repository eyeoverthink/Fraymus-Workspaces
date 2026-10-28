import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function encryptionKey() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || ''
  if (secret.length < 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be at least 32 characters')
  return createHash('sha256').update(secret).digest()
}

export function sealIntegrationSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

export function openIntegrationSecret(value: string) {
  const data = Buffer.from(value, 'base64url')
  if (data.length < 29) throw new Error('invalid encrypted integration data')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
}

export function integrationEncryptionConfigured() {
  return (process.env.INTEGRATION_ENCRYPTION_KEY || '').length >= 32
}
