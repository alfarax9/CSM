import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import type { ContainerDetail } from '@/lib/receipts';
import { ScanWorkspace } from './scan-workspace';

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, container] = await Promise.all([getMe(), apiGet<ContainerDetail>(`/containers/${id}`)]);
  if (!container.acceptsReceipts) redirect(`/containers/${id}`);
  const staff = me.role !== 'sales';
  const sales = staff ? await apiGet<{ id: string; name: string }[]>('/sales') : [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-page font-semibold">Scan resi · Container {container.seqNo}</h1>
        <Link href={`/containers/${id}`} className="ml-auto text-green-800 hover:underline">
          Kembali ke sheet
        </Link>
      </div>
      <p className="text-meta text-ink-muted">
        Baca otomatis dari foto belum aktif: Serial No dan field lain diketik dari foto untuk sementara. Foto tetap tersimpan sebagai
        bukti dan untuk pengecekan Admin.
      </p>
      <ScanWorkspace containerId={id} staff={staff} sales={sales} />
    </div>
  );
}
