import type { PackageType, ReceiptStatus } from '@csm/shared';

/** Bentuk data resi dari API (GET /receipts/:id). */
export interface ReceiptDetail {
  id: string;
  serialNo: number;
  status: ReceiptStatus;
  container: { id: string; seqNo: number; status: string };
  carriedFromContainerId: string | null;
  sales: { id: string; name: string };
  createdBy: string | null;
  createdAt: string;
  receiptDate: string | null;
  senderName: string | null;
  senderPhone: string | null;
  passportNo: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  address: string | null;
  wilayahCode: string | null;
  destCity: string | null;
  packages: Record<PackageType, number>;
  tas: number;
  krt: number;
  krg: number;
  lain2: number;
  pcs: number;
  koliTotal: number | null;
  weightKg: number | null;
  insurance: number | null;
  packing: number | null;
  vat: number | null;
  grandTotal: number | null;
  cekNote: string | null;
  rejectReason: string | null;
  approvedAt: string | null;
  warnings: string[];
  image: { id: string; version: number; width: number | null; height: number | null; blurScore: number | null; url: string | null } | null;
}

/** Baris sheet Laporan Loading (GET /containers/:id/receipts). */
export interface ReceiptRow {
  id: string;
  serialNo: number;
  destCity: string | null;
  tas: number;
  krt: number;
  krg: number;
  lain2: number;
  pcs: number;
  koliTotal: number | null;
  koliMismatch: boolean;
  weightKg: number | null;
  sales: string;
  senderName: string | null;
  recipientName: string | null;
  cekNote: string | null;
  status: ReceiptStatus;
}

export interface ContainerDetail {
  id: string;
  seqNo: number;
  boxNo: string | null;
  loadingDate: string | null;
  status: 'draft' | 'loading' | 'locked' | 'shipped' | 'unloading' | 'closed';
  acceptsReceipts: boolean;
  purgeAt: string | null;
}

export interface SerialDuplicate {
  receiptId: string;
  serialNo: number;
  containerSeqNo: number;
  sales: string;
  createdBy: string | null;
  createdAt: string;
  deleted: boolean;
}

export const RECEIPT_TONE: Record<ReceiptStatus, 'good' | 'neutral' | 'bad' | 'plain'> = {
  captured: 'plain',
  processing: 'plain',
  needs_review: 'neutral',
  submitted: 'neutral',
  ready: 'neutral',
  approved: 'good',
  exported: 'good',
  rejected: 'bad',
};

export const PACKAGE_LABEL: Record<PackageType, string> = {
  koper: 'Koper',
  karton: 'Karton',
  hambal: 'Hambal',
  selimut: 'Selimut',
  drum: 'Drum',
  kotak_besi: 'Kotak besi',
  karung: 'Karung',
};

export interface SalesSummaryRow {
  salesId: string;
  sales: string;
  invoices: number;
  pcs: number;
  kg: number;
  approved: number;
  pending: number;
}

export interface SalesSummary {
  rows: SalesSummaryRow[];
  total: Omit<SalesSummaryRow, 'salesId' | 'sales'>;
}
