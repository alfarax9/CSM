/** Skor confidence & warna status (PRD §6, §8). */

export type ConfidenceBand = 'good' | 'neutral' | 'bad';

export interface FieldThreshold {
  greenMin: number;
  yellowMin: number;
}

export const DEFAULT_THRESHOLD: FieldThreshold = { greenMin: 0.9, yellowMin: 0.7 };

/** c_field = min(c_vlm, c_nlp) × (validasi lolos ? 1 : 0,5) */
export function combineConfidence(cVlm: number, cNlp: number, validationPassed: boolean): number {
  return Math.min(cVlm, cNlp) * (validationPassed ? 1 : 0.5);
}

export function confidenceBand(conf: number, t: FieldThreshold = DEFAULT_THRESHOLD): ConfidenceBand {
  if (conf >= t.greenMin) return 'good';
  if (conf >= t.yellowMin) return 'neutral';
  return 'bad';
}

/** Kategori kualitas resi untuk donut Super Admin (PRD F9a). */
export type ReceiptQuality = 'valid' | 'kurang_valid' | 'tidak_valid';

export function receiptQuality(bands: readonly ConfidenceBand[], serialReadable: boolean): ReceiptQuality {
  if (!serialReadable || bands.includes('bad')) return 'tidak_valid';
  if (bands.includes('neutral')) return 'kurang_valid';
  return 'valid';
}
