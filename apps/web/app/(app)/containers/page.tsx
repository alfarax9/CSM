import Link from 'next/link';
import { CONTAINER_STATUS_LABEL, type ContainerStatus } from '@csm/shared';
import { Grid, Pill, td, th } from '@/components/ui';
import { apiGet, getMe } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/format';
import { CreateContainerForm, StatusActions } from './container-actions';

export interface ContainerRow {
  id: string;
  seqNo: number;
  boxNo: string | null;
  loadingDate: string | null;
  status: ContainerStatus;
  purgeAt: string | null;
  receipts: number;
}

const TONE: Record<ContainerStatus, 'good' | 'neutral' | 'bad' | 'plain'> = {
  draft: 'plain',
  loading: 'good',
  locked: 'neutral',
  shipped: 'plain',
  unloading: 'neutral',
  closed: 'plain',
};

export default async function ContainersPage() {
  const [me, containers] = await Promise.all([getMe(), apiGet<ContainerRow[]>('/containers')]);
  const staff = me.role !== 'sales';
  const total = containers.reduce((n, c) => n + c.receipts, 0);

  return (
    <div className="grid gap-4">
      <h1 className="text-page font-semibold">Container</h1>
      {staff && <CreateContainerForm nextSeq={(containers[0]?.seqNo ?? 0) + 1} />}
      {containers.length === 0 ? (
        <p className="text-ink-muted">Belum ada container. {staff ? 'Buat container pertama untuk mulai scan resi.' : 'Tunggu Admin membuat container.'}</p>
      ) : (
        <Grid
          head={
            <tr>
              <th className={`${th} num`}>No</th>
              <th className={th}>Nomor box</th>
              <th className={th}>Tgl loading</th>
              <th className={th}>Status</th>
              <th className={`${th} num`}>{staff ? 'Resi' : 'Resi saya'}</th>
              <th className={th}>Aksi</th>
            </tr>
          }
        >
          {containers.map((c) => (
            <tr key={c.id} className="hover:bg-green-50">
              <td className={`${td} num font-semibold`}>
                <Link href={`/containers/${c.id}`} className="text-green-800 hover:underline">
                  {c.seqNo}
                </Link>
              </td>
              <td className={td}>{c.boxNo ?? '–'}</td>
              <td className={td}>{fmtDate(c.loadingDate)}</td>
              <td className={td}>
                <Pill tone={TONE[c.status]}>{CONTAINER_STATUS_LABEL[c.status]}</Pill>
                {c.purgeAt && <span className="ml-2 text-meta text-ink-muted">foto & data pribadi dihapus {fmtDate(c.purgeAt)}</span>}
              </td>
              <td className={`${td} num`}>{fmtNum(c.receipts)}</td>
              <td className={td}>
                <div className="flex flex-wrap items-center gap-2">
                  {(c.status === 'draft' || c.status === 'loading') && (
                    <Link
                      href={`/containers/${c.id}/scan`}
                      className="flex h-8 items-center rounded-button bg-green-600 px-3 font-semibold text-white hover:bg-green-700"
                    >
                      Scan resi
                    </Link>
                  )}
                  {staff && <StatusActions id={c.id} seqNo={c.seqNo} status={c.status} isSuperAdmin={me.role === 'super_admin'} />}
                </div>
              </td>
            </tr>
          ))}
          <tr className="bg-canvas font-semibold">
            <td className={td} colSpan={4}>
              Total {containers.length} container
            </td>
            <td className={`${td} num`}>{fmtNum(total)}</td>
            <td className={td} />
          </tr>
        </Grid>
      )}
    </div>
  );
}
