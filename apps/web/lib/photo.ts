'use client';

/**
 * Pengolahan foto resi di browser (PRD F1): ubah ke JPEG + perkecil, lalu cek kualitas sebelum dikirim.
 * Ambang batas di bawah belum dikalibrasi dengan resi asli — sesuaikan setelah uji lapangan.
 */

const MAX_SIDE = 2400; // cukup untuk tulisan tangan, hemat kuota seluler
const JPEG_QUALITY = 0.88;

export const QUALITY_LIMITS = {
  /** Varians Laplacian minimum; di bawah ini dianggap buram. */
  blurMin: 60,
  /** Rata-rata kecerahan minimum (0–255). */
  brightnessMin: 70,
  /** Porsi piksel terbakar (nilai 254–255); di atas ini dianggap silau. Kertas putih biasa tidak sampai terbakar. */
  glareMax: 0.12,
};

export interface PhotoQuality {
  blur: number;
  brightness: number;
  glare: number;
  problems: string[];
}

export interface ProcessedPhoto {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  quality: PhotoQuality;
}

type Source = HTMLVideoElement | HTMLImageElement | ImageBitmap;

function sourceSize(src: Source) {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

/** Kecerahan, ketajaman (varians Laplacian), dan silau dari versi kecil grayscale. */
function measure(canvas: HTMLCanvasElement): PhotoQuality {
  const scale = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  let sum = 0;
  let glare = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    gray[i] = g;
    sum += g;
    if (g >= 254) glare++;
  }

  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w]! + gray[i + w]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const mean = lapSum / Math.max(n, 1);
  const blur = lapSq / Math.max(n, 1) - mean * mean;
  const brightness = sum / (w * h);
  const glareRatio = glare / (w * h);

  const problems: string[] = [];
  if (brightness < QUALITY_LIMITS.brightnessMin) problems.push('Foto terlalu gelap. Cari tempat lebih terang atau nyalakan lampu.');
  if (blur < QUALITY_LIMITS.blurMin) problems.push('Foto buram. Tahan HP lebih stabil, dekatkan sekitar 10 cm, lalu ulangi.');
  if (glareRatio > QUALITY_LIMITS.glareMax) problems.push('Ada pantulan cahaya (silau) di kertas. Miringkan sedikit kertas atau HP.');
  return { blur: Math.round(blur * 10) / 10, brightness: Math.round(brightness), glare: Math.round(glareRatio * 1000) / 1000, problems };
}

/** Gambar sumber (frame kamera atau file) → JPEG terkompresi + hasil cek kualitas. */
export async function processPhoto(src: Source, flip = false): Promise<ProcessedPhoto> {
  const { w, h } = sourceSize(src);
  if (!w || !h) throw new Error('Gambar kosong. Ulangi foto.');
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  if (flip) {
    // Kamera yang mengirim gambar cermin: balik horizontal agar tulisan di foto terbaca normal.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  const quality = measure(canvas);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal membuat JPEG.'))), 'image/jpeg', JPEG_QUALITY),
  );
  return { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, quality };
}

/** File dari galeri (JPG/PNG/HEIC — browser yang mendekode) → foto terproses. */
export async function processFile(file: File): Promise<ProcessedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('Format foto tidak bisa dibuka di browser ini. Pakai JPG atau PNG.');
    });
    return await processPhoto(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cookie(name: string): string {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1] ?? '';
}

/** Kirim JPEG mentah ke API. */
export async function uploadJpeg<T>(path: string, photo: ProcessedPhoto) {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-csm-csrf': cookie('csm_csrf'), 'x-blur-score': String(photo.quality.blur) },
    body: photo.blob,
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: undefined }) | { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (res.ok) return { ok: true as const, data: json as T };
  const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  return { ok: false as const, code: err?.code, details: err?.details, error: err?.message ?? `Upload gagal (HTTP ${res.status}).` };
}
