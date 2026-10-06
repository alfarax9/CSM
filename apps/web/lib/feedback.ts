'use client';

/**
 * Umpan balik scan (PRD F7): bunyi sukses berbeda dari bunyi duplikat, plus getar di HP.
 * Memakai Web Audio (tanpa file suara); diam saja jika browser tidak mendukung.
 */

let ctx: AudioContext | null = null;

function tone(freq: number, startMs: number, durMs: number, volume = 0.15) {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + startMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  } catch {
    /* audio tidak tersedia */
  }
}

/** Satu bunyi tinggi singkat: foto diterima / resi tersimpan. */
export function feedbackSuccess() {
  tone(1320, 0, 120);
  navigator.vibrate?.(40);
}

/** Dua bunyi rendah + getar panjang: data ganda diblokir. */
export function feedbackDuplicate() {
  tone(330, 0, 180, 0.2);
  tone(250, 220, 260, 0.2);
  navigator.vibrate?.([120, 60, 120]);
}
