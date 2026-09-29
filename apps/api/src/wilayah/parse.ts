/**
 * Parser data kode wilayah Kepmendagri (format dump SQL cahyadsn/wilayah).
 * Kode bertingkat: "35" provinsi · "35.04" kab/kota · "35.04.01" kecamatan · "35.04.01.2001" desa/kelurahan.
 */

export type WilayahLevel = 'prov' | 'kab' | 'kec' | 'desa';

export interface WilayahRow {
  code: string;
  name: string;
  level: WilayahLevel;
  parentCode: string | null;
  shortName: string | null;
}

const LEVELS: readonly WilayahLevel[] = ['prov', 'kab', 'kec', 'desa'];

/** Singkatan provinsi yang dipakai di kolom Tujuan (PRD §4: "provinsi jauh → singkatan"). */
export const PROVINCE_SHORT_NAMES: Record<string, string> = {
  '11': 'Aceh',
  '12': 'Sumut',
  '13': 'Sumbar',
  '14': 'Riau',
  '15': 'Jambi',
  '16': 'Sumsel',
  '17': 'Bengkulu',
  '18': 'Lampung',
  '19': 'Babel',
  '21': 'Kepri',
  '31': 'DKI Jakarta',
  '32': 'Jabar',
  '33': 'Jateng',
  '34': 'DIY',
  '35': 'Jatim',
  '36': 'Banten',
  '51': 'Bali',
  '52': 'NTB',
  '53': 'NTT',
  '61': 'Kalbar',
  '62': 'Kalteng',
  '63': 'Kalsel',
  '64': 'Kaltim',
  '65': 'Kaltara',
  '71': 'Sulut',
  '72': 'Sulteng',
  '73': 'Sulsel',
  '74': 'Sultra',
  '75': 'Gorontalo',
  '76': 'Sulbar',
  '81': 'Maluku',
  '82': 'Malut',
  '91': 'Papua',
  '92': 'Papua Barat',
  '93': 'Papua Selatan',
  '94': 'Papua Tengah',
  '95': 'Papua Pegunungan',
  '96': 'Papua Barat Daya',
};

const KAB_PREFIX = /^(Kabupaten Administrasi|Kota Administrasi|Kabupaten|Kota)\s+/;

/** "Kabupaten Pamekasan" → "Pamekasan" (nilai kolom Tujuan / Kota Tujuan). */
export function kabShortName(name: string): string {
  return name.replace(KAB_PREFIX, '');
}

const ROW_RE = /\('([0-9.]+)','((?:[^']|'')*)'\)/g;

export function parseWilayahSql(sql: string): WilayahRow[] {
  const rows: WilayahRow[] = [];
  for (const match of sql.matchAll(ROW_RE)) {
    const code = match[1]!;
    const name = match[2]!.replace(/''/g, "'").trim();
    const parts = code.split('.');
    const level = LEVELS[parts.length - 1];
    if (!level) continue;
    rows.push({
      code,
      name,
      level,
      parentCode: parts.length > 1 ? parts.slice(0, -1).join('.') : null,
      shortName: level === 'prov' ? (PROVINCE_SHORT_NAMES[code] ?? null) : level === 'kab' ? kabShortName(name) : null,
    });
  }
  // Induk harus masuk lebih dulu (foreign key parent_code).
  return rows.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}
