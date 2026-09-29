/**
 * Import gazetteer wilayah Kemendagri ke tabel `wilayah` (PRD §6, §10). Idempoten.
 *   npm run wilayah:import -w @csm/api             # unduh dari sumber yang dikunci
 *   npm run wilayah:import -w @csm/api -- --file x.sql
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { db } from '../src/db.js';
import { parseWilayahSql, type WilayahRow } from '../src/wilayah/parse.js';

// Kepmendagri No 300.2.2-2138 Tahun 2025 · github.com/cahyadsn/wilayah (MIT), dikunci per commit.
const SOURCE_URL =
  'https://raw.githubusercontent.com/cahyadsn/wilayah/d68e8d5516f969d1905d0b2940f20034becb0db7/db/wilayah.sql';
const SOURCE_SHA256 = 'c4c3396d9380d4edee072af1d9dff83573b574d7cd00a6562cf82e200e954031';
const CHUNK = 5000;

async function loadSql(): Promise<string> {
  const fileArg = process.argv.indexOf('--file');
  if (fileArg > -1) return readFile(process.argv[fileArg + 1]!, 'utf8');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Gagal mengunduh data wilayah: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE_SHA256) throw new Error(`Checksum data wilayah tidak cocok (${sha}).`);
  return buf.toString('utf8');
}

async function upsert(rows: WilayahRow[]): Promise<void> {
  const prisma = db();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await prisma.$executeRaw`
      INSERT INTO wilayah (code, name, level, parent_code, short_name)
      SELECT * FROM unnest(
        ${part.map((r) => r.code)}::text[],
        ${part.map((r) => r.name)}::text[],
        ${part.map((r) => r.level)}::"WilayahLevel"[],
        ${part.map((r) => r.parentCode)}::text[],
        ${part.map((r) => r.shortName)}::text[]
      )
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name, level = EXCLUDED.level,
        parent_code = EXCLUDED.parent_code, short_name = EXCLUDED.short_name`;
  }
}

const rows = parseWilayahSql(await loadSql());
const count = (l: string) => rows.filter((r) => r.level === l).length;
await upsert(rows);
console.log(
  `wilayah: ${rows.length} baris (prov ${count('prov')}, kab/kota ${count('kab')}, kec ${count('kec')}, desa/kel ${count('desa')})`,
);
await db().$disconnect();
