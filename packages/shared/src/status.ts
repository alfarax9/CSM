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
  // processing = Ganti foto (resi scan); ready/submitted = diperbaiki lalu dikirim ulang (resi manual).
  rejected: ['processing', 'ready', 'submitted'],
};

/** Label status resi untuk UI; kata kerja lampau (PRD §8 "Status pill"). */
export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  captured: 'Diterima',
  processing: 'Diproses',
  needs_review: 'Perlu review',
  submitted: 'Dikirim ke Admin',
  ready: 'Siap approve',
  approved: 'Approved',
  exported: 'Diekspor',
  rejected: 'Ditolak',
};

export function canTransitionReceipt(from: ReceiptStatus, to: ReceiptStatus): boolean {
  return RECEIPT_TRANSITIONS[from].includes(to);
}

/** Status container (PRD §7). `unloading` = Pecah Pos. */
export const CONTAINER_STATUSES = ['draft', 'loading', 'locked', 'shipped', 'unloading', 'closed'] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

/** Label status container untuk UI (PRD §7). */
export const CONTAINER_STATUS_LABEL: Record<ContainerStatus, string> = {
  draft: 'Draft',
  loading: 'Loading',
  locked: 'Locked',
  shipped: 'Shipped',
  unloading: 'Pecah Pos',
  closed: 'Closed',
};

/** Siklus maju Draft → Loading → Locked → Shipped → Pecah Pos → Closed, plus unlock Locked → Loading. */
export const CONTAINER_TRANSITIONS: Record<ContainerStatus, readonly ContainerStatus[]> = {
  draft: ['loading'],
  loading: ['locked'],
  locked: ['shipped', 'loading'],
  shipped: ['unloading'],
  unloading: ['closed'],
  closed: [],
};

export function canTransitionContainer(from: ContainerStatus, to: ContainerStatus): boolean {
  return CONTAINER_TRANSITIONS[from].includes(to);
}

/** Unlock (Locked → Loading) hanya Super Admin (PRD §3). */
export function isContainerUnlock(from: ContainerStatus, to: ContainerStatus): boolean {
  return from === 'locked' && to === 'loading';
}

/** Resi hanya bisa ditambah pada status Draft dan Loading. */
export function containerAcceptsReceipts(status: ContainerStatus): boolean {
  return status === 'draft' || status === 'loading';
}

/** Ekspor final hanya setelah container Locked (PRD F5). */
export function containerAllowsFinalExport(status: ContainerStatus): boolean {
  return status !== 'draft' && status !== 'loading';
}
