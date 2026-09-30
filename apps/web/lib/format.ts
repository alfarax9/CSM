const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
const dateTime = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
});
const num = new Intl.NumberFormat('id-ID');

/** "28 Agu 2026" (PRD §12: format tanggal Indonesia). */
export const fmtDate = (v: string | Date | null) => (v ? date.format(new Date(v)) : '–');
export const fmtDateTime = (v: string | Date | null) => (v ? dateTime.format(new Date(v)) : '–');
/** "16.050" */
export const fmtNum = (v: number) => num.format(v);
