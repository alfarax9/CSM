'use client';

/**
 * Deteksi "kertas siap difoto" untuk auto-capture (PRD F1: ambil otomatis saat kertas stabil 0,6 detik).
 *
 * Pendekatan ringan tanpa OpenCV.js (hemat kuota & baterai HP): pada versi kecil frame kamera,
 * kertas dianggap siap jika (1) area di dalam bingkai A5 lebih terang dari luarnya — kertas resi pink/putih
 * di atas alas yang lebih gelap, (2) ada tekstur tulisan/garis di dalamnya, dan (3) gambar diam.
 * Di alas yang terang/putih deteksi bisa tidak terpicu; tombol "Ambil foto" manual tetap tersedia.
 */

export const AUTO_LIMITS = {
  /** Perbedaan rata-rata antar frame (0–255) di bawah ini = diam. */
  stillMax: 5,
  /** Kecerahan dalam bingkai minus luar bingkai. */
  contrastMin: 18,
  /** Simpangan baku kecerahan dalam bingkai (ada tulisan/garis, bukan bidang polos). */
  textureMin: 12,
  /** Lama harus stabil sebelum diambil (PRD: 0,6 detik). */
  holdMs: 600,
};

export interface FrameStats {
  still: number;
  contrast: number;
  texture: number;
  ready: boolean;
}

const W = 60;
const H = 80; // rasio 3:4 sama dengan kotak viewfinder

/** Analisis satu frame. `prev` diisi/diperbarui untuk menghitung gerakan. */
export function analyzeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, prev: { gray: Float32Array | null }): FrameStats | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  // Potongan tengah 3:4 seperti object-cover di viewfinder.
  const cropW = Math.min(vw, (vh * 3) / 4);
  const cropH = Math.min(vh, (vw * 4) / 3);
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(video, (vw - cropW) / 2, (vh - cropH) / 2, cropW, cropH, 0, 0, W, H);
  const { data } = g.getImageData(0, 0, W, H);

  // Bingkai A5 portrait: tinggi 88% kotak, lebar mengikuti 148:210, di tengah.
  const fh = H * 0.88;
  const fw = (fh * 148) / 210;
  const x0 = (W - fw) / 2;
  const y0 = (H - fh) / 2;

  const gray = new Float32Array(W * H);
  let inSum = 0;
  let inSq = 0;
  let inN = 0;
  let outSum = 0;
  let outN = 0;
  let diff = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
      gray[i] = v;
      if (prev.gray) diff += Math.abs(v - prev.gray[i]!);
      // Sisakan margin 2 piksel di tepi bingkai agar garis bingkai/tepi kertas tidak bercampur.
      const inside = x > x0 + 2 && x < x0 + fw - 2 && y > y0 + 2 && y < y0 + fh - 2;
      const outside = x < x0 - 1 || x > x0 + fw + 1 || y < y0 - 1 || y > y0 + fh + 1;
      if (inside) {
        inSum += v;
        inSq += v * v;
        inN++;
      } else if (outside) {
        outSum += v;
        outN++;
      }
    }
  }
  const still = prev.gray ? diff / (W * H) : 255;
  prev.gray = gray;
  const inMean = inSum / Math.max(inN, 1);
  const texture = Math.sqrt(Math.max(inSq / Math.max(inN, 1) - inMean * inMean, 0));
  const contrast = inMean - outSum / Math.max(outN, 1);
  const ready = still < AUTO_LIMITS.stillMax && contrast > AUTO_LIMITS.contrastMin && texture > AUTO_LIMITS.textureMin;
  return { still, contrast, texture, ready };
}
