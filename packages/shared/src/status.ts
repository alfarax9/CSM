/** Status resi (PRD §7, §10). */
export const RECEIPT_STATUSES = [
  'captured',
  'processing',
  'needs_review',
  'submitted',
  'ready',
  'approved',
  'exported',
  'rejected',
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/** Transisi yang diizinkan. Kunci = status asal. */
export const RECEIPT_TRANSITIONS: Record<ReceiptStatus, readonly ReceiptStatus[]> = {
  captured: ['processing'],
  processing: ['needs_review', 'ready'],
  needs_review: ['submitted', 'ready', 'rejected', 'processing'],
  submitted: ['approved', 'rejected'],
  ready: ['approved', 'rejected'],
  approved: ['exported'],
  exported: ['approved'],
  rejected: ['processing'],
};

export function canTransitionReceipt(from: ReceiptStatus, to: ReceiptStatus): boolean {
  return RECEIPT_TRANSITIONS[from].includes(to);
}

/** Status container (PRD §7). `unloading` = Pecah Pos. */
export const CONTAINER_STATUSES = ['draft', 'loading', 'locked', 'shipped', 'unloading', 'closed'] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

/** Resi hanya bisa ditambah pada status Draft dan Loading. */
export function containerAcceptsReceipts(status: ContainerStatus): boolean {
  return status === 'draft' || status === 'loading';
}

/** Ekspor final hanya setelah container Locked (PRD F5). */
export function containerAllowsFinalExport(status: ContainerStatus): boolean {
  return status !== 'draft' && status !== 'loading';
}
