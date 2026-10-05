import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FIELD_KEYS,
  PACKAGE_TYPES,
  ReceiptExtractionSchema,
  BOX_NO_PATTERN,
  auditCategory,
  auditIssues,
  canTransitionContainer,
  canTransitionReceipt,
  isContainerUnlock,
  normalizeBoxNo,
  combineConfidence,
  confidenceBand,
  containerAllowsFinalExport,
  isValidPassport,
  isValidPhones,
  normalizeNumeric,
  normalizePassport,
  normalizePhones,
  parseCount,
  parseWeightKg,
  receiptQuality,
} from '../src/index.js';

describe('validators (PRD §4, §6)', () => {
  it('menormalisasi paspor dari contoh PRD', () => {
    expect(normalizePassport('C-8060823')).toBe('C8060823');
    expect(normalizePassport('E - 4499 715')).toBe('E4499715');
    expect(isValidPassport('XD671976')).toBe(true);
    expect(isValidPassport('8060823')).toBe(false);
  });

  it('memperbaiki O→0 hanya di field numerik', () => {
    expect(normalizeNumeric('O81249345417')).toBe('081249345417');
  });

  it('memisahkan dua nomor HP dengan spasi', () => {
    const phones = normalizePhones('085524446728 / 085213038585');
    expect(phones).toBe('085524446728 085213038585');
    expect(isValidPhones(phones)).toBe(true);
    expect(isValidPhones('0855')).toBe(false);
  });

  it('satuan PCS tidak ikut menjadi angka 5', () => {
    expect(parseCount('2 - PCS')).toBe('2');
    expect(normalizeNumeric('2 - PCS')).toBe('25'); // alasan parseCount dibutuhkan
  });

  it('mengambil angka berat', () => {
    expect(parseWeightKg('145 - Kg')).toBe(145);
    expect(parseWeightKg('-')).toBeNull();
  });
});

describe('confidence (PRD §6, F9a)', () => {
  it('memotong setengah saat validasi gagal', () => {
    expect(combineConfidence(0.71, 0.93, true)).toBe(0.71);
    expect(combineConfidence(0.95, 0.95, false)).toBe(0.475);
  });

  it('memetakan ke good/neutral/bad', () => {
    expect(confidenceBand(0.9)).toBe('good');
    expect(confidenceBand(0.7)).toBe('neutral');
    expect(confidenceBand(0.69)).toBe('bad');
  });

  it('mengkategorikan kualitas resi', () => {
    expect(receiptQuality(['good', 'good'], true)).toBe('valid');
    expect(receiptQuality(['good', 'neutral'], true)).toBe('kurang_valid');
    expect(receiptQuality(['good', 'neutral'], false)).toBe('tidak_valid');
  });
});

describe('status (PRD §7)', () => {
  it('resi rejected kembali lewat Ganti foto, bukan scan baru', () => {
    expect(canTransitionReceipt('rejected', 'processing')).toBe(true);
    expect(canTransitionReceipt('rejected', 'approved')).toBe(false);
  });

  it('siklus container maju satu langkah, unlock hanya Locked → Loading', () => {
    expect(canTransitionContainer('draft', 'loading')).toBe(true);
    expect(canTransitionContainer('draft', 'locked')).toBe(false);
    expect(canTransitionContainer('closed', 'unloading')).toBe(false);
    expect(isContainerUnlock('locked', 'loading')).toBe(true);
  });

  it('menormalisasi nomor box container', () => {
    expect(normalizeBoxNo('txgu7181980')).toBe('TXGU 7181980');
    expect(BOX_NO_PATTERN.test(normalizeBoxNo('TXGU-7181980'))).toBe(true);
  });

  it('ekspor final hanya setelah lock', () => {
    expect(containerAllowsFinalExport('loading')).toBe(false);
    expect(containerAllowsFinalExport('locked')).toBe(true);
  });
});

describe('schema ekstraksi', () => {
  const json = JSON.parse(
    readFileSync(new URL('../schemas/receipt-extraction.schema.json', import.meta.url), 'utf8'),
  ) as { required: string[]; properties: { packages: { required: string[] } } };

  it('JSON schema (untuk ml) sama dengan Zod schema (untuk api)', () => {
    expect(json.required).toEqual([...FIELD_KEYS]);
    expect(Object.keys(ReceiptExtractionSchema.shape)).toEqual([...FIELD_KEYS]);
    expect(json.properties.packages.required).toEqual([...PACKAGE_TYPES]);
  });
});

describe('audit (PRD F8d, aturan sementara)', () => {
  const lengkap = {
    koliTotal: 1, pcs: 1, weightKg: 20, destCity: 'Bandung', hasPassport: true, hasRecipientPhone: true,
    address: 'Kp. Wanasuka', senderName: 'Hanipah Bt Ade', recipientName: 'Ibu Yayah',
  };

  it('resi lengkap valid', () => {
    expect(auditCategory(auditIssues(lengkap))).toBe('valid');
  });

  it('koli tidak cocok → tidak valid', () => {
    const issues = auditIssues({ ...lengkap, koliTotal: 3, pcs: 2 });
    expect(auditCategory(issues)).toBe('tidak_valid');
    expect(issues[0]?.message).toContain('koli di kertas 3');
  });

  it('tujuan kosong saja → kurang valid', () => {
    expect(auditCategory(auditIssues({ ...lengkap, destCity: null }))).toBe('kurang_valid');
  });
});
