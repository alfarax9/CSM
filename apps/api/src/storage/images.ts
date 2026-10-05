import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Penyimpanan foto resi di volume `uploads` (PRD §9, §12): nama file UUID, di luar folder publik,
 * hanya bisa dibuka lewat URL bertanda tangan berumur 5 menit.
 *
 *   tmp/<token>.jpg + .json   foto yang sudah di-scan tapi resinya belum disimpan (dibersihkan setelah 24 jam)
 *   receipts/<uuid>.jpg       foto yang sudah terkait ke resi (path relatif disimpan di receipt_images.file_path)
 */

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // PRD §12: maks 15 MB per foto
export const SIGNED_URL_TTL_S = 5 * 60;
const TEMP_TTL_MS = 24 * 60 * 60 * 1000;

export interface TempMeta {
  token: string;
  sha256: string;
  width: number;
  height: number;
  blurScore: number | null;
  userId: string;
  containerId: string;
  createdAt: string;
}

/** Ukuran gambar dari header JPEG (marker SOF), tanpa library gambar native. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    // SOF0–SOF15 kecuali DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function createImageStore(root: string, secret: string) {
  const tmpDir = path.join(root, 'tmp');
  const receiptDir = path.join(root, 'receipts');
  const tokenOk = (t: string) => /^[0-9a-f-]{36}$/.test(t);

  async function sweepTemp() {
    const files = await readdir(tmpDir).catch(() => [] as string[]);
    const now = Date.now();
    await Promise.all(
      files.map(async (f) => {
        const p = path.join(tmpDir, f);
        const s = await stat(p).catch(() => null);
        if (s && now - s.mtimeMs > TEMP_TTL_MS) await rm(p, { force: true });
      }),
    );
  }

  function sign(imageId: string, exp: number) {
    return createHmac('sha256', secret).update(`${imageId}.${exp}`).digest('base64url');
  }

  return {
    async saveTemp(buf: Buffer, meta: Omit<TempMeta, 'token' | 'createdAt'>): Promise<TempMeta> {
      await mkdir(tmpDir, { recursive: true });
      const full: TempMeta = { ...meta, token: randomUUID(), createdAt: new Date().toISOString() };
      await writeFile(path.join(tmpDir, `${full.token}.jpg`), buf, { mode: 0o600 });
      await writeFile(path.join(tmpDir, `${full.token}.json`), JSON.stringify(full), { mode: 0o600 });
      void sweepTemp();
      return full;
    },

    async loadTemp(token: string): Promise<TempMeta | null> {
      if (!tokenOk(token)) return null;
      const raw = await readFile(path.join(tmpDir, `${token}.json`), 'utf8').catch(() => null);
      return raw ? (JSON.parse(raw) as TempMeta) : null;
    },

    /** Pindahkan foto sementara ke folder resi; kembalikan path relatif untuk receipt_images.file_path. */
    async commitTemp(token: string): Promise<string> {
      await mkdir(receiptDir, { recursive: true });
      const rel = path.join('receipts', `${randomUUID()}.jpg`);
      await rename(path.join(tmpDir, `${token}.jpg`), path.join(root, rel));
      await rm(path.join(tmpDir, `${token}.json`), { force: true });
      return rel;
    },

    /** Simpan foto langsung ke folder resi (dipakai Ganti foto). */
    async saveReceiptImage(buf: Buffer): Promise<string> {
      await mkdir(receiptDir, { recursive: true });
      const rel = path.join('receipts', `${randomUUID()}.jpg`);
      await writeFile(path.join(root, rel), buf, { mode: 0o600 });
      return rel;
    },

    async remove(rel: string) {
      await rm(path.join(root, rel), { force: true });
    },

    absolute(rel: string): string {
      const p = path.resolve(root, rel);
      if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('Path foto di luar folder uploads.');
      return p;
    },

    signedUrl(imageId: string): string {
      const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_S;
      return `/api/v1/receipt-images/${imageId}?exp=${exp}&sig=${sign(imageId, exp)}`;
    },

    verifySignature(imageId: string, exp: string, sig: string): boolean {
      const e = Number(exp);
      if (!Number.isInteger(e) || e < Date.now() / 1000) return false;
      const expected = Buffer.from(sign(imageId, e));
      const actual = Buffer.from(sig);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
  };
}

export type ImageStore = ReturnType<typeof createImageStore>;
