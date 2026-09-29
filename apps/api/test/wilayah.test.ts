import { describe, expect, it } from 'vitest';
import { kabShortName, parseWilayahSql } from '../src/wilayah/parse.js';

const SAMPLE = `
INSERT INTO wilayah (kode, nama) VALUES
('35.04.01.2001','Ngranti'),
('35','Jawa Timur'),
('35.04','Kabupaten Tulungagung'),
('35.04.01','Tulungagung'),
('73.22.05.2003','Ma''rang');
`;

describe('parseWilayahSql', () => {
  const rows = parseWilayahSql(SAMPLE);

  it('menentukan level dan induk dari kode', () => {
    const kab = rows.find((r) => r.code === '35.04');
    expect(kab).toMatchObject({ level: 'kab', parentCode: '35', shortName: 'Tulungagung' });
    expect(rows.find((r) => r.code === '35.04.01.2001')).toMatchObject({ level: 'desa', parentCode: '35.04.01' });
  });

  it('memberi singkatan provinsi', () => {
    expect(rows.find((r) => r.code === '35')?.shortName).toBe('Jatim');
  });

  it('mengurutkan induk lebih dulu', () => {
    expect(rows.map((r) => r.level)).toEqual(['prov', 'kab', 'kec', 'desa', 'desa']);
  });

  it("membaca apostrof ''", () => {
    expect(rows.find((r) => r.code === '73.22.05.2003')?.name).toBe("Ma'rang");
  });
});

describe('kabShortName', () => {
  it('membuang awalan Kabupaten/Kota', () => {
    expect(kabShortName('Kabupaten Pamekasan')).toBe('Pamekasan');
    expect(kabShortName('Kota Administrasi Jakarta Selatan')).toBe('Jakarta Selatan');
  });
});
