import Link from 'next/link';
import { AUDIT_FIELD_LABEL, type AuditIssue } from '@csm/shared';
import { Grid, td, th } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { MarkAudited } from './mark-audited';

type Tab = 'tidak_valid' | 'kurang_valid' | 'diaudit';

interface AuditRow {
  id: string;
  serialNo: number;
  container: { id: string; seqNo: number };
  sales: string;
  createdAt: string;
  category: 'tidak_valid' | 'kurang_valid' | 'valid';
  issues: AuditIssue[];
  auditedAt: string | null;
  auditedBy: string | null;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'tidak_valid', label: 'Tidak valid' },
  { key: 'kurang_valid', label: 'Kurang valid' },
  { key: 'diaudit', label: 'Sudah diaudit' },
];

/** Halaman Audit (PRD F8d). Kategori sementara dari aturan validasi; nanti digabung confidence VLM. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tab?: string; field?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'tidak_valid';
  const qs = new URLSearchParams({ category: tab, ...(sp.field ? { field: sp.field } : {}) });
  const data = await apiGet<{ counts: Record<Tab, number>; rows: AuditRow[] }>(`/audit/receipts?${qs}`);
  const fields = [...new Set(data.rows.flatMap((r) => r.issues.map((i) => i.field)))];

  return (
    <div className="grid gap-4">
      <h1 className="text-page font-semibold">Audit</h1>
      <p className="text-ink-muted">
        Resi dengan data yang perlu dicek ke kertas asli. Buka resi, perbaiki, lalu tandai sudah diaudit.
      </p>

      <nav aria-label="Kategori" className="flex border-b border-grid text-cell">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/audit?tab=${t.key}`}
            aria-current={t.key === tab ? 'page' : undefined}
            className={
              t.key === tab
                ? '-mb-px border-x border-t border-b-2 border-grid border-b-green-600 bg-surface px-4 py-1.5 font-semibold text-green-800'
                : 'px-4 py-1.5 text-ink-muted hover:text-green-800'
            }
          >
            {t.label} <span className="num">({data.counts[t.key]})</span>
          </Link>
        ))}
      </nav>

      {fields.length > 1 || sp.field ? (
        <div className="flex flex-wrap items-center gap-2 text-meta">
          <span className="text-ink-muted">Filter field:</span>
          <Link href={`/audit?tab=${tab}`} className={!sp.field ? 'font-semibold text-green-800' : 'text-ink-muted hover:text-green-800'}>
            Semua
          </Link>
          {(sp.field && !fields.includes(sp.field) ? [...fields, sp.field] : fields).map((f) => (
            <Link
              key={f}
              href={`/audit?tab=${tab}&field=${f}`}
              className={sp.field === f ? 'font-semibold text-green-800' : 'text-ink-muted hover:text-green-800'}
            >
              {AUDIT_FIELD_LABEL[f] ?? f}
            </Link>
          ))}
        </div>
      ) : null}

      {data.rows.length === 0 ? (
        <p className="text-ink-muted">{tab === 'diaudit' ? 'Belum ada resi yang diaudit.' : 'Tidak ada resi di kategori ini.'}</p>
      ) : (
        <Grid
          head={
            <tr>
              <th className={`${th} num`}>Serial No</th>
              <th className={`${th} num`}>Container</th>
              <th className={th}>Sales</th>
              <th className={th}>Diinput</th>
              <th className={th}>Masalah</th>
              <th className={th}>{tab === 'diaudit' ? 'Diaudit' : 'Aksi'}</th>
            </tr>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.id} className="hover:bg-green-50">
              <td className={`${td} num font-semibold`}>
                <Link href={`/receipts/${r.id}`} className="text-green-800 hover:underline">
                  {r.serialNo}
                </Link>
              </td>
              <td className={`${td} num`}>
                <Link href={`/containers/${r.container.id}`} className="hover:underline">
                  {r.container.seqNo}
                </Link>
              </td>
              <td className={td}>{r.sales}</td>
              <td className={td}>{fmtDateTime(r.createdAt)}</td>
              <td className={`${td} min-w-56 max-w-xs whitespace-normal py-1`}>
                <div className="flex flex-wrap gap-1">
                  {r.issues.map((i) => (
                    <span
                      key={i.field}
                      title={AUDIT_FIELD_LABEL[i.field] ?? i.field}
                      className={`rounded-cell px-2 py-0.5 text-meta ${i.level === 'bad' ? 'bg-bad text-bad-ink' : 'bg-neutral text-neutral-ink'}`}
                    >
                      {i.message.charAt(0).toUpperCase() + i.message.slice(1)}
                    </span>
                  ))}
                </div>
              </td>
              <td className={td}>
                {r.auditedAt ? (
                  <span className="text-meta text-ink-muted">
                    {r.auditedBy ?? '–'}, {fmtDateTime(r.auditedAt)}
                  </span>
                ) : (
                  <MarkAudited id={r.id} />
                )}
              </td>
            </tr>
          ))}
        </Grid>
      )}
    </div>
  );
}
