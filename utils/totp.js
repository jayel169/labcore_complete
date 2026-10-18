const crypto = require('crypto');
const { JWT_SECRET } = require('../middleware/auth');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of String(text).toUpperCase().replace(/=+$/, '')) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('Invalid Base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeForStep(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1000000).padStart(6, '0');
}

function verifyCode(secret, input, now = Date.now(), window = 1) {
  if (!/^\d{6}$/.test(String(input || ''))) return null;
  const currentStep = Math.floor(now / 30000);
  const candidate = Buffer.from(String(input));
  for (let offset = -window; offset <= window; offset++) {
    const step = currentStep + offset;
    const expected = Buffer.from(codeForStep(secret, step));
    if (crypto.timingSafeEqual(candidate, expected)) return step;
  }
  return null;
}

function encryptionKey() {
  return crypto.createHash('sha256').update('labcore-mfa-secret:').update(JWT_SECRET).digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

function decryptSecret(envelope) {
  const [iv, tag, ciphertext] = String(envelope).split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { generateSecret, verifyCode, encryptSecret, decryptSecret };
