import Link from 'next/link';
import { CONTAINER_STATUS_LABEL, RECEIPT_STATUS_LABEL } from '@csm/shared';
import { Grid, Pill, td, th } from '@/components/ui';
import { apiGet, getMe } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/format';
import { type ContainerDetail, RECEIPT_TONE, type ReceiptRow, type SalesSummary } from '@/lib/receipts';
import { RowActions } from './row-actions';
import { SalesSummaryTable } from './sales-summary';
import { SheetTabs } from './sheet-tabs';

/** Kolom sheet `Laporan Loading-{no}` (PRD §4) dengan huruf kolom template di header (PRD §8). */
const COLUMNS = [
  ['A', 'No'],
  ['B', 'Invoice'],
  ['C', 'Tujuan'],
  ['D', 'Tas'],
  ['E', 'Krt'],
  ['F', 'Krg'],
  ['G', 'Lain2'],
  ['H', 'PCS'],
  ['I', 'Kg'],
  ['J', 'Ket.'],
  ['K', 'Cek'],
] as const;
const NUMERIC = new Set(['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I']);

export default async function ContainerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sheet?: string }>;
}) {
  const { id } = await params;
  const sheet = (await searchParams).sheet === 'rekap' ? 'rekap' : 'loading';
  const [me, container, rows, summary] = await Promise.all([
    getMe(),
    apiGet<ContainerDetail>(`/containers/${id}`),
    apiGet<ReceiptRow[]>(`/containers/${id}/receipts`),
    apiGet<SalesSummary>(`/containers/${id}/summary`),
  ]);
  const staff = me.role !== 'sales';
  const sum = (k: 'pcs' | 'weightKg') => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const pending = rows.filter((r) => r.status === 'ready' || r.status === 'submitted').length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-page font-semibold">
          Container {container.seqNo}
          {container.boxNo && <span className="font-normal text-ink-muted"> · {container.boxNo}</span>}
        </h1>
        <Pill tone="plain">{CONTAINER_STATUS_LABEL[container.status]}</Pill>
        <span className="text-meta text-ink-muted">Loading {fmtDate(container.loadingDate)}</span>
        {container.acceptsReceipts && (
          <div className="ml-auto flex gap-2">
            <Link
              href={`/containers/${id}/new`}
              className="flex h-8 items-center rounded-button border border-grid bg-surface px-3 font-semibold text-ink hover:bg-green-50"
            >
              Input manual
            </Link>
            <Link
              href={`/containers/${id}/scan`}
              className="flex h-8 items-center rounded-button bg-green-600 px-3 font-semibold text-white hover:bg-green-700"
            >
              Scan resi
            </Link>
          </div>
        )}
      </div>

      {staff && pending > 0 && <p className="text-ink-muted">{pending} resi menunggu approve.</p>}

      <SheetTabs containerId={id} active={sheet} />

      {sheet === 'rekap' ? (
        <SalesSummaryTable summary={summary} staff={staff} />
      ) : rows.length === 0 ? (
        <p className="text-ink-muted">
          Belum ada resi di container ini.{container.acceptsReceipts ? ' Input resi pertama.' : ''}
        </p>
      ) : (
        <Grid
          head={
            <>
              <tr className="text-meta">
                {COLUMNS.map(([letter]) => (
                  <th key={letter} className={`${th} h-6 text-center`}>
                    {letter}
                  </th>
                ))}
                <th className={`${th} h-6`} />
                <th className={`${th} h-6`} />
                {staff && <th className={`${th} h-6`} />}
              </tr>
              <tr>
                {COLUMNS.map(([letter, name]) => (
                  <th key={letter} className={`${th} ${NUMERIC.has(letter) ? 'num' : ''}`}>
                    {name}
                  </th>
                ))}
                <th className={th}>Pengirim</th>
                <th className={th}>Status</th>
                {staff && <th className={th}>Aksi</th>}
              </tr>
            </>
          }
        >
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-green-50">
              <td className={`${td} num text-ink-muted`}>{i + 1}</td>
              <td className={`${td} num font-semibold`}>
                <Link href={`/receipts/${r.id}`} className="text-green-800 hover:underline">
                  {r.serialNo}
                </Link>
              </td>
              <td className={td}>{r.destCity ?? <span className="text-ink-muted">–</span>}</td>
              {(['tas', 'krt', 'krg', 'lain2'] as const).map((k) => (
                <td key={k} className={`${td} num`}>
                  {r[k] || ''}
                </td>
              ))}
              <td className={`${td} num ${r.koliMismatch ? 'bg-neutral text-neutral-ink' : ''}`} title={r.koliMismatch ? `Koli di kertas: ${r.koliTotal}` : undefined}>
                {r.pcs}
              </td>
              <td className={`${td} num`}>{r.weightKg ?? ''}</td>
              <td className={td}>{r.sales}</td>
              <td className={td}>{r.cekNote ?? ''}</td>
              <td className={td}>{r.senderName ?? ''}</td>
              <td className={td}>
                <Pill tone={RECEIPT_TONE[r.status]}>{RECEIPT_STATUS_LABEL[r.status]}</Pill>
              </td>
              {staff && (
                <td className={td}>
                  <RowActions id={r.id} serialNo={r.serialNo} status={r.status} />
                </td>
              )}
            </tr>
          ))}
          <tr className="bg-canvas font-semibold">
            <td className={td} colSpan={2}>
              {fmtNum(rows.length)} inv
            </td>
            <td className={td} colSpan={5} />
            <td className={`${td} num`}>{fmtNum(sum('pcs'))}</td>
            <td className={`${td} num`}>{fmtNum(sum('weightKg'))}</td>
            <td className={td} colSpan={staff ? 5 : 4} />
          </tr>
        </Grid>
      )}
    </div>
  );
}
