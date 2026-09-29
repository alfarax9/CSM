import { z } from 'zod';

/** Tipe paket di form resi (PRD §4). */
export const PACKAGE_TYPES = ['koper', 'karton', 'hambal', 'selimut', 'drum', 'kotak_besi', 'karung'] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

/** Kolom Excel tujuan: Tas / Krt / Krg / Lain2. */
export const PACKAGE_EXCEL_COLUMN: Record<PackageType, 'tas' | 'krt' | 'krg' | 'lain2'> = {
  koper: 'tas',
  karton: 'krt',
  karung: 'krg',
  hambal: 'lain2',
  selimut: 'lain2',
  drum: 'lain2',
  kotak_besi: 'lain2',
};

/** Field yang dibaca VLM dari satu resi. */
export const FIELD_KEYS = [
  'serial_no',
  'receipt_date',
  'sender_name',
  'passport_no',
  'sender_phone',
  'recipient_name',
  'address',
  'recipient_phone',
  'packages',
  'koli_total',
  'weight_kg',
  'insurance',
  'packing',
  'vat',
  'grand_total',
  'corner_note',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Field berisi data pribadi — dianonimkan 30 hari setelah container Closed (PRD §12). */
export const PERSONAL_FIELDS = [
  'sender_name',
  'passport_no',
  'sender_phone',
  'recipient_name',
  'address',
  'recipient_phone',
] as const satisfies readonly FieldKey[];

const nullableText = z.string().nullable();

/**
 * Output mentah VLM (sebelum NLP). Semua nilai teks apa adanya dari kertas;
 * `null` jika kotak kosong atau tidak terbaca. Harus sama dengan
 * schemas/receipt-extraction.schema.json yang dikirim ke Hugging Face.
 */
export const ReceiptExtractionSchema = z.object({
  serial_no: nullableText,
  receipt_date: nullableText,
  sender_name: nullableText,
  passport_no: nullableText,
  sender_phone: nullableText,
  recipient_name: nullableText,
  address: nullableText,
  recipient_phone: nullableText,
  packages: z.object(
    Object.fromEntries(PACKAGE_TYPES.map((p) => [p, nullableText])) as Record<PackageType, typeof nullableText>,
  ),
  koli_total: nullableText,
  weight_kg: nullableText,
  insurance: nullableText,
  packing: nullableText,
  vat: nullableText,
  grand_total: nullableText,
  corner_note: nullableText,
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;
