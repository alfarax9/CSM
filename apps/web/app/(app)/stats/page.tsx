import Link from 'next/link';
import { Grid, td, th } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/format';

type GroupBy = 'container' | 'sales' | 'day';

interface Stats {
  groupBy: GroupBy;
  from: string;
  to: string;
  rows: { group: string; unique: number; review: number; approved: number; duplicates: number }[];
  total: { unique: number; review: number; approved: number; duplicates: number };
}

const GROUPS: { key: GroupBy; label: string; column: string }[] = [
  { key: 'container', label: 'Per container', column: 'Container' },
  { key: 'sales', label: 'Per sales', column: 'Sales' },
  { key: 'day', label: 'Per hari', column: 'Tanggal' },
];

/** Jumlah data scan tanpa duplikat (PRD F8b): tabel dengan baris total, bukan kartu angka besar. */
export default async function StatsPage({ searchParams }: { searchParams: Promise<{ groupBy?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const groupBy: GroupBy = GROUPS.some((g) => g.key === sp.groupBy) ? (sp.groupBy as GroupBy) : 'container';
  const qs = new URLSearchParams({ groupBy, ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) });
  const stats = await apiGet<Stats>(`/admin/stats?${qs}`);
  const group = GROUPS.find((g) => g.key === groupBy)!;
  const range = (k: GroupBy) => `/stats?${new URLSearchParams({ groupBy: k, ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) })}`;

  return (
    <div className="grid gap-4">
      <h1 className="text-page font-semibold">Statistik scan</h1>
      <p className="text-ink-muted">
        Resi unik = Serial No berbeda yang tidak ditolak dan tidak dihapus. Percobaan duplikat yang diblokir dihitung terpisah dan
        tidak pernah masuk total.
      </p>

      <form className="flex flex-wrap items-end gap-3 text-meta" action="/stats">
        <input type="hidden" name="groupBy" value={groupBy} />
        <label className="grid gap-1 text-ink-muted">
          Dari
          <input name="from" type="date" defaultValue={sp.from ?? stats.from.slice(0, 10)} className="h-8 rounded-cell border border-grid bg-surface px-2" />
        </label>
        <label className="grid gap-1 text-ink-muted">
          Sampai
          <input name="to" type="date" defaultValue={sp.to ?? stats.to.slice(0, 10)} className="h-8 rounded-cell border border-grid bg-surface px-2" />
        </label>
        <button type="submit" className="h-8 rounded-button border border-grid bg-surface px-3 font-semibold hover:bg-green-50">
          Terapkan
        </button>
        <span className="text-ink-muted">
          {fmtDate(stats.from)} – {fmtDate(stats.to)}
        </span>
      </form>

      <nav aria-label="Kelompok" className="flex border-b border-grid text-cell">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={range(g.key)}
            aria-current={g.key === groupBy ? 'page' : undefined}
            className={
              g.key === groupBy
                ? '-mb-px border-x border-t border-b-2 border-grid border-b-green-600 bg-surface px-4 py-1.5 font-semibold text-green-800'
                : 'px-4 py-1.5 text-ink-muted hover:text-green-800'
            }
          >
            {g.label}
          </Link>
        ))}
      </nav>

      {stats.rows.length === 0 ? (
        <p className="text-ink-muted">Belum ada data scan pada rentang tanggal ini.</p>
      ) : (
        <Grid
          head={
            <tr>
              <th className={th}>{group.column}</th>
              <th className={`${th} num`}>Resi unik</th>
              <th className={`${th} num`}>Perlu review</th>
              <th className={`${th} num`}>Approved</th>
              <th className={`${th} num`}>Duplikat diblokir</th>
            </tr>
          }
        >
          {stats.rows.map((r) => (
            <tr key={r.group} className="hover:bg-green-50">
              <td className={td}>{groupBy === 'day' ? fmtDate(`${r.group}T12:00:00+07:00`) : r.group}</td>
              <td className={`${td} num`}>{fmtNum(r.unique)}</td>
              <td className={`${td} num ${r.review ? 'bg-neutral text-neutral-ink' : ''}`}>{fmtNum(r.review)}</td>
              <td className={`${td} num`}>{fmtNum(r.approved)}</td>
              <td className={`${td} num ${r.duplicates ? 'bg-bad text-bad-ink' : ''}`}>{fmtNum(r.duplicates)}</td>
            </tr>
          ))}
          <tr className="bg-canvas font-semibold">
            <td className={td}>Total</td>
            <td className={`${td} num`}>{fmtNum(stats.total.unique)}</td>
            <td className={`${td} num`}>{fmtNum(stats.total.review)}</td>
            <td className={`${td} num`}>{fmtNum(stats.total.approved)}</td>
            <td className={`${td} num`}>{fmtNum(stats.total.duplicates)}</td>
          </tr>
        </Grid>
      )}
    </div>
  );
}
