import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';

interface ContainerItem {
  id: string;
  seqNo: number;
  status: string;
}

/**
 * Pintasan "Scan resi" (PRD §7 Skenario A): langsung ke container aktif —
 * container berstatus Loading terbaru, atau Draft terbaru jika belum ada yang Loading.
 */
export default async function ScanShortcutPage() {
  const [me, containers] = await Promise.all([getMe(), apiGet<ContainerItem[]>('/containers')]);
  const pick = (status: string) => containers.filter((c) => c.status === status).sort((a, b) => b.seqNo - a.seqNo)[0];
  const active = pick('loading') ?? pick('draft');
  if (active) redirect(`/containers/${active.id}/scan`);

  return (
    <div className="grid max-w-xl gap-3">
      <h1 className="text-page font-semibold">Scan resi</h1>
      <p className="text-ink-muted">
        Belum ada container yang menerima resi (status Draft atau Loading).{' '}
        {me.role === 'sales' ? 'Minta Admin membuat container atau memulai loading.' : 'Buat container atau mulai loading terlebih dulu.'}
      </p>
      {me.role !== 'sales' && (
        <Link href="/containers" className="text-green-800 hover:underline">
          Buka daftar container
        </Link>
      )}
    </div>
  );
}
