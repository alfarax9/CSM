import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Data pribadi (paspor, HP) terenkripsi di kolom bytea (PRD §10 "Catatan data sensitif").
 * AES-256-GCM di API: format [iv 12 byte | tag 16 byte | ciphertext]. Blind index HMAC-SHA256 dengan
 * kunci terpisah dipakai untuk mencari/membandingkan (deteksi isi mirip F7 lapis 5) tanpa mendekripsi.
 */
export interface Pii {
  encrypt(value: string | null | undefined): Uint8Array<ArrayBuffer> | null;
  decrypt(value: Uint8Array | null | undefined): string | null;
  blindIndex(value: string | null | undefined): Uint8Array<ArrayBuffer> | null;
}

const bytes = (b: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(b);

export function createPii(encryptionKey: string, bidxKey: string): Pii {
  const key = createHash('sha256').update(encryptionKey).digest();
  return {
    encrypt(value) {
      if (!value) return null;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return bytes(Buffer.concat([iv, cipher.getAuthTag(), enc]));
    },
    decrypt(value) {
      if (!value || value.length < 29) return null;
      const buf = Buffer.from(value);
      const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    },
    blindIndex(value) {
      if (!value) return null;
      return bytes(createHmac('sha256', bidxKey).update(value).digest());
    },
  };
}

/** "C8060823" → "C80•••823"; "081249345417" → "0812•••5417". Untuk yang tidak berhak (PRD §3, §12). */
export function maskValue(value: string | null): string | null {
  if (!value) return value;
  return value
    .split(' ')
    .map((part) => {
      if (part.length <= 6) return '•'.repeat(part.length);
      const head = part.length >= 11 ? 4 : 3;
      return `${part.slice(0, head)}•••${part.slice(-(part.length >= 11 ? 4 : 3))}`;
    })
    .join(' ');
}
