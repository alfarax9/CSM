import Link from 'next/link';
import { RECEIPT_STATUS_LABEL } from '@csm/shared';
import { ReceiptForm } from '@/components/receipt-form';
import { Pill } from '@/components/ui';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { RECEIPT_TONE, type ReceiptDetail } from '@/lib/receipts';
import { PhotoViewer } from '@/components/photo-viewer';
import { MoveReceipt } from './move-receipt';
import { ReplacePhoto } from './replace-photo';
import { ReceiptStatusActions } from './status-actions';

const EDITABLE_CONTAINER = new Set(['draft', 'loading', 'locked']);

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, r] = await Promise.all([getMe(), apiGet<ReceiptDetail>(`/receipts/${id}`)]);
  const staff = me.role !== 'sales';
  const [sales, containers] = staff
    ? await Promise.all([
        apiGet<{ id: string; name: string }[]>('/sales'),
        apiGet<{ id: string; seqNo: number; status: string }[]>('/containers'),
      ])
    : [[], []];
  // Tujuan pindah: container lain yang masih menerima resi (Draft/Loading).
  const moveTargets = containers.filter((c) => c.id !== r.container.id && (c.status === 'draft' || c.status === 'loading'));
  const canMove = staff && ['draft', 'loading', 'locked'].includes(r.container.status);
  const carriedFrom = r.carriedFromContainerId ? containers.find((c) => c.id === r.carriedFromContainerId) : undefined;
  const locked = r.status === 'approved' || r.status === 'exported';
  const readOnly = !EDITABLE_CONTAINER.has(r.container.status) || (!staff && locked);

  return (
    <div className="grid max-w-7xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-page font-semibold">Resi {r.serialNo}</h1>
        <Pill tone={RECEIPT_TONE[r.status]}>{RECEIPT_STATUS_LABEL[r.status]}</Pill>
        <Link href={`/containers/${r.container.id}`} className="text-green-800 hover:underline">
          Container {r.container.seqNo}
        </Link>
        <span className="text-meta text-ink-muted">
          Input {r.createdBy ? `oleh ${r.createdBy}, ` : ''}
          {fmtDateTime(r.createdAt)}
        </span>
      </div>
      {carriedFrom && <p className="text-ink-muted">Dipindah dari Container {carriedFrom.seqNo}.</p>}
      {r.status === 'rejected' && r.rejectReason && (
        <p className="rounded-cell bg-bad px-3 py-2 text-bad-ink">
          Ditolak: {r.rejectReason}. Perbaiki lalu simpan untuk mengirim ulang.
        </p>
      )}
      <ReceiptStatusActions id={r.id} status={r.status} staff={staff} />
      {canMove && <MoveReceipt id={r.id} targets={moveTargets.map((c) => ({ id: c.id, seqNo: c.seqNo }))} />}
      {/* Review split (PRD F3): foto 45% | form 55% di layar lebar, bertumpuk di HP. */}
      <div className={r.image ? 'grid items-start gap-4 lg:grid-cols-[45fr_55fr]' : 'grid gap-4'}>
        {r.image && (
          <div className="grid gap-2 lg:sticky lg:top-0">
            {r.image.url ? (
              <PhotoViewer src={r.image.url} alt={`Foto resi ${r.serialNo}`} />
            ) : (
              <p className="rounded-cell border border-grid bg-surface p-4 text-ink-muted">
                Foto sudah dihapus sesuai kebijakan retensi.
              </p>
            )}
            <p className="text-meta text-ink-muted">Foto versi {r.image.version}</p>
            {!readOnly && <ReplacePhoto id={r.id} hasPhoto />}
          </div>
        )}
        <div className="grid gap-3">
          {!r.image && !readOnly && <ReplacePhoto id={r.id} hasPhoto={false} />}
          <ReceiptForm containerId={r.container.id} staff={staff} sales={sales} initial={r} readOnly={readOnly} />
        </div>
      </div>
    </div>
  );
}
