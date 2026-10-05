import { Grid, td, th } from '@/components/ui';
import { fmtNum } from '@/lib/format';
import type { SalesSummary } from '@/lib/receipts';

/** Rekap per sales (PRD F6) — menggantikan pivot "PVT Loading"; dihitung di API, bukan pivot Excel. */
export function SalesSummaryTable({ summary, staff }: { summary: SalesSummary; staff: boolean }) {
  if (summary.rows.length === 0) {
    return <p className="text-ink-muted">Belum ada resi untuk direkap.</p>;
  }
  const kg = (v: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(v);
  return (
    <div className="grid gap-2">
      <Grid
        head={
          <tr>
            <th className={th}>Sales</th>
            <th className={`${th} num`}>Invoice</th>
            <th className={`${th} num`}>PCS</th>
            <th className={`${th} num`}>Kg</th>
            <th className={`${th} num`}>Approved</th>
            <th className={`${th} num`}>Menunggu</th>
          </tr>
        }
      >
        {summary.rows.map((r) => (
          <tr key={r.salesId} className="hover:bg-green-50">
            <td className={td}>{r.sales}</td>
            <td className={`${td} num`}>{fmtNum(r.invoices)}</td>
            <td className={`${td} num`}>{fmtNum(r.pcs)}</td>
            <td className={`${td} num`}>{kg(r.kg)}</td>
            <td className={`${td} num`}>{fmtNum(r.approved)}</td>
            <td className={`${td} num ${r.pending ? 'bg-neutral text-neutral-ink' : ''}`}>{fmtNum(r.pending)}</td>
          </tr>
        ))}
        {staff && (
          <tr className="bg-canvas font-semibold">
            <td className={td}>Total</td>
            <td className={`${td} num`}>{fmtNum(summary.total.invoices)}</td>
            <td className={`${td} num`}>{fmtNum(summary.total.pcs)}</td>
            <td className={`${td} num`}>{kg(summary.total.kg)}</td>
            <td className={`${td} num`}>{fmtNum(summary.total.approved)}</td>
            <td className={`${td} num`}>{fmtNum(summary.total.pending)}</td>
          </tr>
        )}
      </Grid>
      <p className="text-meta text-ink-muted">Resi yang ditolak tidak dihitung.</p>
    </div>
  );
}
