import { redirect } from 'next/navigation';
import { ReceiptForm } from '@/components/receipt-form';
import { apiGet, getMe } from '@/lib/api';
import type { ContainerDetail } from '@/lib/receipts';

export default async function NewReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, container] = await Promise.all([getMe(), apiGet<ContainerDetail>(`/containers/${id}`)]);
  if (!container.acceptsReceipts) redirect(`/containers/${id}`);
  const staff = me.role !== 'sales';
  const sales = staff ? await apiGet<{ id: string; name: string }[]>('/sales') : [];

  return (
    <div className="grid max-w-5xl gap-4">
      <h1 className="text-page font-semibold">Input resi · Container {container.seqNo}</h1>
      {staff && sales.length === 0 && (
        <p className="rounded-cell bg-neutral px-3 py-2 text-neutral-ink">
          Belum ada user Sales aktif. Daftarkan sales di menu Kelola user sebelum input resi.
        </p>
      )}
      <ReceiptForm containerId={id} staff={staff} sales={sales} />
    </div>
  );
}
