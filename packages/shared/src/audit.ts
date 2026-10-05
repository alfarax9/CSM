/**
 * Aturan audit data resi (PRD F8d). Sementara dipakai untuk resi input manual; saat VLM aktif,
 * kategori dari confidence model (extraction_runs.quality) digabung dengan aturan ini.
 */

export type AuditLevel = 'bad' | 'neutral';
export type AuditCategory = 'tidak_valid' | 'kurang_valid' | 'valid';

export interface AuditIssue {
  field: string;
  level: AuditLevel;
  message: string;
}

export interface AuditInput {
  koliTotal: number | null;
  pcs: number;
  weightKg: number | null;
  destCity: string | null;
  hasPassport: boolean;
  hasRecipientPhone: boolean;
  address: string | null;
  senderName: string | null;
  recipientName: string | null;
}

export const AUDIT_FIELD_LABEL: Record<string, string> = {
  koliTotal: 'Koli',
  weightKg: 'Berat',
  packages: 'Paket',
  destCity: 'Tujuan',
  passportNo: 'No paspor',
  recipientPhone: 'No HP penerima',
  address: 'Alamat',
  senderName: 'Pengirim',
  recipientName: 'Penerima',
};

export function auditIssues(r: AuditInput): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const bad = (field: string, message: string) => issues.push({ field, level: 'bad', message });
  const neutral = (field: string, message: string) => issues.push({ field, level: 'neutral', message });

  if (r.pcs === 0) bad('packages', 'belum ada paket yang diisi');
  if (r.koliTotal !== null && r.pcs > 0 && r.koliTotal !== r.pcs) bad('koliTotal', `koli di kertas ${r.koliTotal} ≠ jumlah paket ${r.pcs}`);
  if (r.weightKg === null || r.weightKg <= 0) bad('weightKg', 'berat kosong');

  if (!r.destCity) neutral('destCity', 'tujuan belum dipilih dari daftar wilayah');
  if (!r.hasPassport) neutral('passportNo', 'no paspor kosong');
  if (!r.hasRecipientPhone) neutral('recipientPhone', 'no HP penerima kosong');
  if (!r.address?.trim()) neutral('address', 'alamat kosong');
  if (!r.senderName?.trim()) neutral('senderName', 'nama pengirim kosong');
  if (!r.recipientName?.trim()) neutral('recipientName', 'nama penerima kosong');
  return issues;
}

export function auditCategory(issues: readonly AuditIssue[]): AuditCategory {
  if (issues.some((i) => i.level === 'bad')) return 'tidak_valid';
  if (issues.length > 0) return 'kurang_valid';
  return 'valid';
}
