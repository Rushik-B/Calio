import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm'; // Modern, authenticated encryption algorithm
const IV_LENGTH = 16; // For GCM, the IV is typically 12 bytes, but 16 is also common and acceptable
const AUTH_TAG_LENGTH = 16; // GCM includes an authentication tag

const encryptionKeyHex = process.env.TOKEN_ENCRYPTION_KEY;

if (!encryptionKeyHex || encryptionKeyHex.length !== 64) {
  throw new Error('Invalid TOKEN_ENCRYPTION_KEY: Must be a 64-character hex string (32 bytes). Please generate one and add it to your .env file.');
}

const key = Buffer.from(encryptionKeyHex, 'hex');

/**
 * Encrypts plaintext using AES-256-GCM.
 * @param text The plaintext to encrypt.
 * @returns A string containing the IV, auth tag, and ciphertext, concatenated and base64 encoded.
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const tag = cipher.getAuthTag();

  // Concatenate IV, auth tag, and ciphertext for storage
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypts text encrypted with AES-256-GCM.
 * @param encryptedText The base64 encoded string containing IV:authTag:ciphertext.
 * @returns The original plaintext.
 */
export function decrypt(encryptedText: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format');
    }
    const [ivBase64, tagBase64, encryptedData] = parts;

    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');

    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
        throw new Error('Invalid IV or auth tag length');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    // Handle decryption errors appropriately - e.g., return empty string, null, or re-throw
    // Returning an empty string might mask issues, consider logging and returning null/throwing
    // For now, we re-throw to make errors obvious during development
    throw new Error('Decryption failed');
  }
} 