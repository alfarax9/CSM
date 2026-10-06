/** Aturan format field (PRD §4, §6). */

export const PASSPORT_PATTERN = /^[A-Z]{1,2}\d{6,7}$/;
export const PHONE_PATTERN = /^08\d{8,11}$/;
export const SERIAL_PATTERN = /^\d{4,5}$/;
/** Nomor container ISO 6346: 4 huruf + 7 digit, mis. "TXGU 7181980". */
export const BOX_NO_PATTERN = /^[A-Z]{4} \d{7}$/;

/** Normalisasi kesalahan baca klasik (O→0, I→1, S→5) — HANYA untuk field numerik. */
export function normalizeNumeric(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/I/g, '1')
    .replace(/S/g, '5')
    .replace(/[^0-9]/g, '');
}

/** "2 - PCS" → "2". Satuan dibuang dulu agar S di "PCS" tidak ikut menjadi 5. */
export function parseCount(raw: string): string {
  // Angka pertama; satuan tulisan tangan sering terbaca aneh (DCS, POS, DOG). Tanpa digit: O→0 dst.
  return raw.match(/\d+/)?.[0] ?? normalizeNumeric(raw);
}

/** "C-8060823" → "C8060823". */
export function normalizePassport(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPassport(value: string): boolean {
  return PASSPORT_PATTERN.test(value);
}

/** Beberapa nomor dipisah spasi, seperti di template. Setiap nomor harus lolos pola. */
export function normalizePhones(raw: string): string {
  // Nomor berkelompok ("0857 7575 5299") digabung; kelompok baru = nomor baru hanya jika diawali 0
  // dan nomor sebelumnya sudah ≥ 10 digit.
  const numbers: string[] = [];
  for (const group of raw.split(/[/,;\n]+/)) {
    let cur = '';
    for (const chunk of group.split(/\s+/).map(normalizeNumeric)) {
      if (!chunk) continue;
      if (cur.length >= 10 && chunk.startsWith('0')) {
        numbers.push(cur);
        cur = chunk;
      } else cur += chunk;
    }
    if (cur) numbers.push(cur);
  }
  return numbers.join(' ');
}

export function isValidPhones(value: string): boolean {
  const parts = value.split(' ').filter(Boolean);
  return parts.length > 0 && parts.every((p) => PHONE_PATTERN.test(p));
}

export function isValidSerial(value: string): boolean {
  return SERIAL_PATTERN.test(value);
}

/** "145 - Kg" → 145. Mengembalikan null jika tidak ada angka. */
export function parseWeightKg(raw: string): number | null {
  const match = raw.replace(',', '.').match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** "txgu7181980" → "TXGU 7181980". */
export function normalizeBoxNo(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length === 11 ? `${compact.slice(0, 4)} ${compact.slice(4)}` : raw.trim().toUpperCase();
}
