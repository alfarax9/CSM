import { describe, expect, it } from 'vitest';
import { createPii, maskValue } from '../src/pii.js';

const pii = createPii('kunci-enkripsi-uji-0123456789abcdef', 'kunci-bidx-uji-0123456789abcdef');

describe('pii', () => {
  it('enkripsi bolak-balik dan ciphertext tidak memuat teks asli', () => {
    const enc = pii.encrypt('C8060823')!;
    expect(Buffer.from(enc).toString('utf8')).not.toContain('C8060823');
    expect(pii.decrypt(enc)).toBe('C8060823');
    expect(pii.encrypt('C8060823')).not.toEqual(enc); // IV acak
  });

  it('blind index deterministik untuk dedup', () => {
    expect(pii.blindIndex('081249345417')).toEqual(pii.blindIndex('081249345417'));
    expect(pii.blindIndex('081249345417')).not.toEqual(pii.blindIndex('081249345418'));
  });

  it('menyamarkan paspor dan HP', () => {
    expect(maskValue('C8060823')).toBe('C80•••823');
    expect(maskValue('085524446728 085213038585')).toBe('0855•••6728 0852•••8585');
  });
});
