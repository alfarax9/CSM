/**
 * Spike Fase 0 — apakah ExcelJS aman untuk template Excel perusahaan? (PRD §13 "Spike Fase 0")
 *
 *   npm run spike:excel -w @csm/api -- --file ~/csm-data/"Container (258) ....xlsx" --container 258
 *   npm run spike:excel -w @csm/api -- --make-sample /tmp/sample.xlsx   # template tiruan untuk uji alat
 *
 * Workbook asli berisi data pribadi: simpan di luar repo. Hasil ditulis ke <folder file>/spike-excel-out/.
 * Tidak ada isi sel yang dicetak ke layar; laporan hanya berisi struktur (jumlah merge, formula, validasi, dll).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

// ─── Fakta struktur dari isi zip (.xlsx) ─────────────────────────────

interface SheetFacts {
  merges: number;
  mergeRefs: string[];
  formulas: number;
  validations: number;
  condFormats: number;
}
interface BookFacts {
  sheets: Map<string, SheetFacts>;
  parts: Set<string>;
  definedNames: number;
}

const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;

async function zipFacts(buf: Buffer | ArrayBuffer): Promise<BookFacts> {
  const zip = await JSZip.loadAsync(buf);
  const workbook = (await zip.file('xl/workbook.xml')?.async('string')) ?? '';
  const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
  const targetById = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  const sheets = new Map<string, SheetFacts>();
  for (const m of workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = targetById.get(m[2]!)?.replace(/^\/?(xl\/)?/, '');
    const xml = (target && (await zip.file(`xl/${target}`)?.async('string'))) || '';
    sheets.set(m[1]!, {
      merges: count(xml, /<mergeCell /g),
      mergeRefs: [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map((r) => r[1]!),
      formulas: count(xml, /<f[ >]/g),
      validations: count(xml, /<dataValidation /g),
      condFormats: count(xml, /<conditionalFormatting/g),
    });
  }
  return { sheets, parts: new Set(Object.keys(zip.files)), definedNames: count(workbook, /<definedName /g) };
}

const IMPORTANT_PARTS = /^xl\/(pivotTables|pivotCache|externalLinks|drawings|charts|tables)\//;

function compare(label: string, before: BookFacts, after: BookFacts): string[] {
  const issues: string[] = [];
  for (const p of before.parts) {
    if (IMPORTANT_PARTS.test(p) && !after.parts.has(p)) issues.push(`${label}: bagian file hilang — ${p}`);
  }
  if (after.definedNames < before.definedNames) {
    issues.push(`${label}: defined names berkurang ${before.definedNames} → ${after.definedNames}`);
  }
  for (const [name, b] of before.sheets) {
    const a = after.sheets.get(name);
    if (!a) {
      issues.push(`${label}: sheet hilang — ${name}`);
      continue;
    }
    for (const k of ['merges', 'validations', 'condFormats'] as const) {
      if (a[k] < b[k]) issues.push(`${label}: ${name} · ${k} berkurang ${b[k]} → ${a[k]}`);
    }
    if (a.formulas < b.formulas) issues.push(`${label}: ${name} · formula berkurang ${b.formulas} → ${a.formulas}`);
  }
  return issues;
}

// ─── Skenario tulis: tambah baris resi ke sheet Loading ─────────────

const cellText = (c: ExcelJS.Cell) => String(c.text ?? '').trim().toLowerCase();

function findRow(ws: ExcelJS.Worksheet, col: string, text: string): number | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) if (cellText(ws.getCell(`${col}${r}`)) === text) return r;
  return null;
}

function formulaOf(c: ExcelJS.Cell): string | null {
  const v = c.value as { formula?: string; sharedFormula?: string } | null;
  return v && typeof v === 'object' ? (v.formula ?? v.sharedFormula ?? null) : null;
}

interface AppendResult {
  notes: string[];
  /** Baris pertama yang bergeser; merge cell mulai baris ini harus turun `n` baris. */
  shiftFrom: number | null;
}

/** Sisipkan N baris sebelum baris total sheet Loading (kolom PRD §4: B Invoice … K Cek). */
function appendLoadingRows(ws: ExcelJS.Worksheet, n: number): AppendResult {
  const notes: string[] = [];
  const header = findRow(ws, 'B', 'invoice');
  if (!header) return { notes: [`Loading: header "Invoice" di kolom B tidak ditemukan dalam 60 baris pertama.`], shiftFrom: null };
  let last = header;
  for (let r = header + 1; r <= ws.rowCount; r++) {
    if (typeof ws.getCell(`B${r}`).value === 'number') last = r;
    else if (last > header) break;
  }
  const totalRow = last + 1;
  const totalFormula = formulaOf(ws.getCell(`H${totalRow}`));
  notes.push(`Loading: header baris ${header}, data sampai baris ${last}, baris total ${totalRow} (H: ${totalFormula ?? 'tanpa formula'}).`);

  ws.spliceRows(totalRow, 0, ...Array.from({ length: n }, () => []));
  for (let i = 0; i < n; i++) {
    const r = totalRow + i;
    ws.getCell(`B${r}`).value = 90000 + i; // serial sintetis
    ws.getCell(`C${r}`).value = 'Bandung';
    ws.getCell(`D${r}`).value = 1;
    ws.getCell(`I${r}`).value = 20;
    ws.getCell(`J${r}`).value = 'Mr. Uji';
    ws.getCell(`H${r}`).value = { formula: `SUM(D${r}:G${r})` } as ExcelJS.CellFormulaValue;
  }
  const newTotalRow = totalRow + n;
  const newLast = totalRow + n - 1;
  const newTotal = formulaOf(ws.getCell(`H${newTotalRow}`));
  if (!newTotal) notes.push(`MASALAH: formula baris total hilang setelah sisip baris.`);
  else if (!newTotal.includes(`${newLast}`)) {
    notes.push(`INFO: ExcelJS tidak memperlebar formula total — masih "${newTotal}".`);
    // Perbaikan: eksportir menulis ulang rentang SUM baris total sendiri (rentang diketahui dari DB).
    ws.getRow(newTotalRow).eachCell((cell) => {
      const f = formulaOf(cell);
      if (f) cell.value = { formula: f.replace(new RegExp(`([A-Z]+)${last}\\b`, 'g'), `$1${newLast}`) } as ExcelJS.CellFormulaValue;
    });
    const fixed = formulaOf(ws.getCell(`H${newTotalRow}`));
    notes.push(
      fixed?.includes(`${newLast}`)
        ? `OK (perbaikan eksportir): formula total ditulis ulang → "${fixed}".`
        : `MASALAH: formula total tidak bisa diperbaiki otomatis ("${fixed}").`,
    );
  } else notes.push(`OK: formula total ikut melebar → "${newTotal}".`);

  return { notes, shiftFrom: totalRow };
}

/** Bandingkan posisi merge cell di file hasil (bukan model memori ExcelJS, yang tidak ikut diperbarui). */
function checkMerges(before: string[], after: string[], shiftFrom: number, n: number): string {
  const shift = (range: string) => range.replace(/\d+/g, (d) => String(Number(d) >= shiftFrom ? Number(d) + n : Number(d)));
  const got = new Set(after);
  const wrong = before.filter((m) => !got.has(shift(m)));
  return wrong.length === 0
    ? `OK: ${before.length} merge cell di posisi yang benar (yang di bawah area sisip ikut turun ${n} baris).`
    : `MASALAH: merge cell salah posisi setelah sisip: ${wrong.join(', ')}.`;
}

// ─── Template tiruan (untuk menguji alat ini tanpa data asli) ───────

async function makeSample(file: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Laporan Loading-258(A)');
  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = 'LAPORAN LOADING CONTAINER 258';
  ws.addRow([]);
  ws.getRow(2).values = ['No', 'Invoice', 'Tujuan', 'Tas', 'Krt', 'Krg', 'Lain2', 'PCS', 'Kg', 'Ket.', 'Cek'];
  for (let i = 0; i < 5; i++) {
    const r = 3 + i;
    ws.getRow(r).values = [i + 1, 35610 + i, 'Pamekasan', 1, 0, 0, 0, null, 20 + i, 'Mr. Said', 'C'];
    ws.getCell(`H${r}`).value = { formula: `SUM(D${r}:G${r})` } as ExcelJS.CellFormulaValue;
    ws.getCell(`K${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"C"'] };
  }
  ws.getCell('H8').value = { formula: 'SUM(H3:H7)' } as ExcelJS.CellFormulaValue;
  ws.getCell('I8').value = { formula: 'SUM(I3:I7)' } as ExcelJS.CellFormulaValue;
  ws.mergeCells('A10:K10');
  ws.getCell('A10').value = 'Catatan kaki';
  ws.addConditionalFormatting({
    ref: 'I3:I7',
    rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['100'], priority: 1, style: {} }],
  });
  const dl = wb.addWorksheet('Data Laut Container-258');
  dl.getRow(20).values = ['NO', 'Pengirim', 'Penerima', 'Alamat Lengkap', 'Kota Tujuan', 'Serial No'];
  dl.getCell('E21').value = { formula: 'PROPER(D21)' } as ExcelJS.CellFormulaValue;
  wb.addWorksheet('PVT Loading');
  await wb.xlsx.writeFile(file);
  console.log(`Template tiruan ditulis: ${file}`);
}

// ─── Main ────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const sample = arg('--make-sample');
  if (sample) return makeSample(sample);

  const file = arg('--file');
  if (!file) throw new Error('Pakai --file <workbook.xlsx> atau --make-sample <path>.');
  const container = arg('--container') ?? '258';
  const rows = Number(arg('--rows') ?? '5');
  const outDir = arg('--out') ?? path.join(path.dirname(file), 'spike-excel-out');
  await mkdir(outDir, { recursive: true });

  const original = await readFile(file);
  const before = await zipFacts(original);
  const report: string[] = [`# Spike ExcelJS — ${path.basename(file)}`, ''];
  report.push(`Sheet: ${[...before.sheets.keys()].join(' · ')}`);
  const pivots = [...before.parts].filter((p) => /pivotTables\/.*\.xml$/.test(p)).length;
  const externals = [...before.parts].filter((p) => /externalLinks\/.*\.xml$/.test(p)).length;
  report.push(`Pivot table: ${pivots} · external link: ${externals} · defined names: ${before.definedNames}`, '');

  // A. Buka lalu simpan tanpa perubahan.
  const wbA = new ExcelJS.Workbook();
  await wbA.xlsx.load(original as unknown as ArrayBuffer);
  const bufA = Buffer.from(await wbA.xlsx.writeBuffer());
  await writeFile(path.join(outDir, 'A-roundtrip.xlsx'), bufA);
  const issuesA = compare('A (buka→simpan)', before, await zipFacts(bufA));

  // B. Sisipkan baris resi ke sheet Loading.
  const wbB = new ExcelJS.Workbook();
  await wbB.xlsx.load(original as unknown as ArrayBuffer);
  const loading = wbB.worksheets.find((w) => w.name.startsWith(`Laporan Loading-${container}`));
  const resB = loading ? appendLoadingRows(loading, rows) : { notes: [`Sheet "Laporan Loading-${container}…" tidak ditemukan.`], shiftFrom: null };
  const bufB = Buffer.from(await wbB.xlsx.writeBuffer());
  await writeFile(path.join(outDir, 'B-tambah-baris.xlsx'), bufB);
  const afterB = await zipFacts(bufB);
  const issuesB = compare('B (tambah baris)', before, afterB);
  const notesB = [...resB.notes];
  if (loading && resB.shiftFrom) {
    notesB.push(checkMerges(before.sheets.get(loading.name)?.mergeRefs ?? [], afterB.sheets.get(loading.name)?.mergeRefs ?? [], resB.shiftFrom, rows));
  }

  report.push('## A. Buka → simpan tanpa perubahan', ...(issuesA.length ? issuesA.map((i) => `- ${i}`) : ['- OK: struktur utuh.']), '');
  report.push(`## B. Sisip ${rows} baris di sheet Loading`, ...notesB.map((n) => `- ${n}`), ...issuesB.map((i) => `- ${i}`), '');
  const pass = issuesA.length === 0 && issuesB.length === 0 && !notesB.some((n) => n.startsWith('MASALAH'));
  report.push(
    `## Kesimpulan: ${pass ? 'LULUS' : 'TIDAK LULUS'}`,
    '',
    'Wajib dicek manual: buka A-roundtrip.xlsx dan B-tambah-baris.xlsx di Microsoft Excel —',
    'tidak boleh ada dialog "We found a problem with some content", pivot harus bisa di-refresh.',
  );
  const text = report.join('\n');
  await writeFile(path.join(outDir, 'LAPORAN.md'), text + '\n');
  console.log(text);
  console.log(`\nFile hasil: ${outDir}`);
}

await main();
