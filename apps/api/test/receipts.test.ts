/** Resi manual, deteksi Serial No ganda (F7), enkripsi PII, dan alur status — integrasi ke Postgres lokal. */
import type { Role } from '@csm/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { GoogleGateway } from '../src/auth/google.js';
import { signAccess } from '../src/auth/tokens.js';
import { db } from '../src/db.js';
import { loadEnv } from '../src/env.js';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const DOMAIN = 'resi.csm.test';
const SEQ = [980257, 980258];
const SERIAL = [95616, 95617, 95618];
const env = loadEnv({ ...process.env, NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000' });
const google: GoogleGateway = { authUrl: () => '', exchange: async () => { throw new Error('x'); } };

/** Resi contoh PRD §4 (Serial No diganti agar tidak bentrok dengan data lain). */
const resi = (serialNo: number, extra: Record<string, unknown> = {}) => ({
  serialNo,
  receiptDate: '2026-08-04',
  senderName: 'Hanipah Bt Ade',
  passportNo: 'E - 4499 715',
  recipientName: 'Ibu Yayah',
  recipientPhone: '085524446728 / 085213038585',
  address: 'Kp. Wanasuka Ciwidey Rt.05/06 Ds. Sugihmukti Kec. Pasirjambu Kab. Bandung',
  packages: { koper: 1 },
  koliTotal: 1,
  weightKg: 20,
  insurance: 261,
  packing: 25,
  grandTotal: 286,
  ...extra,
});

describe.skipIf(!HAS_DB)('resi manual', () => {
  const prisma = HAS_DB ? db() : (undefined as never);
  const app = createApp({ env, prisma, google });
  const ids: Record<string, string> = {};
  let c257 = '';
  let c258 = '';
  let bandung = '';

  const as = async (who: 'admin' | 'said' | 'mustofa') => {
    const role: Role = who === 'admin' ? 'admin' : 'sales';
    return `csm_at=${await signAccess({ sub: ids[who]!, role, displayName: null }, env.JWT_SECRET)}`;
  };

  async function cleanup() {
    const rs = await prisma.receipt.findMany({ where: { serialNo: { in: SERIAL } } });
    await prisma.receiptPackage.deleteMany({ where: { receiptId: { in: rs.map((r) => r.id) } } });
    await prisma.receipt.deleteMany({ where: { id: { in: rs.map((r) => r.id) } } });
    const cs = await prisma.container.findMany({ where: { seqNo: { in: SEQ } } });
    await prisma.scanAttempt.deleteMany({ where: { containerId: { in: cs.map((c) => c.id) } } });
    await prisma.container.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  }

  beforeEach(async () => {
    await cleanup();
    ids.admin = (await prisma.user.create({ data: { email: `admin@${DOMAIN}`, name: 'Admin', role: 'admin', displayName: 'Admin Gudang' } })).id;
    ids.said = (await prisma.user.create({ data: { email: `said@${DOMAIN}`, name: 'Said', role: 'sales', displayName: 'Mr. Said' } })).id;
    ids.mustofa = (await prisma.user.create({ data: { email: `mustofa@${DOMAIN}`, name: 'Mustofa', role: 'sales', displayName: 'Mr. Mustofa' } })).id;
    c257 = (await prisma.container.create({ data: { seqNo: SEQ[0]!, status: 'loading', createdBy: ids.admin! } })).id;
    c258 = (await prisma.container.create({ data: { seqNo: SEQ[1]!, status: 'loading', createdBy: ids.admin! } })).id;
    bandung = (await prisma.wilayah.findFirst({ where: { level: 'kab', name: 'Kabupaten Bandung' } }))!.code;
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('Admin input resi: paspor & HP dinormalisasi lalu terenkripsi, Tujuan dari gazetteer', async () => {
    const res = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', await as('admin'))
      .send(resi(SERIAL[0]!, { salesId: ids.said, wilayahCode: bandung }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      serialNo: SERIAL[0],
      status: 'ready',
      passportNo: 'E4499715',
      recipientPhone: '085524446728 085213038585',
      destCity: 'Bandung',
      tas: 1,
      pcs: 1,
      sales: { name: 'Mr. Said' },
      createdBy: 'Admin Gudang',
      warnings: [],
    });
    const raw = await prisma.receipt.findUnique({ where: { id: res.body.id } });
    expect(Buffer.from(raw!.passportNo!).toString('utf8')).not.toContain('E4499715');
    expect(raw!.passportBidx).not.toBeNull();
    const log = await prisma.auditLog.findFirst({ where: { entityId: res.body.id, action: 'receipt.create' } });
    expect(JSON.stringify(log?.after)).not.toContain('E4499715');
  });

  it('Serial No ganda ditolak lintas container dengan lokasi resi lama, dan tercatat di scan_attempts', async () => {
    await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', await as('admin')).send(resi(SERIAL[0]!, { salesId: ids.said }));
    const check = await request(app).get(`/api/v1/receipts/check-serial?no=${SERIAL[0]}`).set('Cookie', await as('mustofa'));
    expect(check.body).toMatchObject({ available: false, duplicate: { containerSeqNo: SEQ[0], sales: 'Mr. Said', createdBy: 'Admin Gudang' } });

    const dup = await request(app).post(`/api/v1/containers/${c258}/receipts`).set('Cookie', await as('admin')).send(resi(SERIAL[0]!, { salesId: ids.said }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SERIAL_DUPLICATE');
    expect(dup.body.error.message).toContain(`Container ${SEQ[0]}`);
    expect(await prisma.scanAttempt.count({ where: { containerId: c258, result: 'duplicate' } })).toBe(1);
  });

  it('Sales: resi tercatat miliknya, langsung dikirim ke Admin, dan tidak bisa melihat resi sales lain', async () => {
    const own = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', await as('said'))
      .send(resi(SERIAL[1]!, { salesId: ids.mustofa }));
    expect(own.status).toBe(201);
    expect(own.body).toMatchObject({ status: 'submitted', sales: { name: 'Mr. Said' } });

    const other = await request(app).get(`/api/v1/receipts/${own.body.id}`).set('Cookie', await as('mustofa'));
    expect(other.status).toBe(404);
    const list = await request(app).get(`/api/v1/containers/${c257}/receipts`).set('Cookie', await as('mustofa'));
    expect(list.body).toHaveLength(0);
  });

  it('Koli beda dengan jumlah paket menghasilkan peringatan, bukan penolakan', async () => {
    const res = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', await as('admin'))
      .send(resi(SERIAL[2]!, { salesId: ids.said, packages: { drum: 2 }, koliTotal: 3 }));
    expect(res.status).toBe(201);
    expect(res.body.lain2).toBe(2);
    expect(res.body.warnings[0]).toContain('Koli di kertas (3)');
  });

  it('Validasi: paspor salah pola, serial 3 digit, dan container Locked ditolak', async () => {
    const cookie = await as('admin');
    const bad = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie)
      .send(resi(SERIAL[2]!, { salesId: ids.said, passportNo: '12345' }));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('No paspor');
    const short = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie).send(resi(123, { salesId: ids.said }));
    expect(short.status).toBe(400);
    await prisma.container.update({ where: { id: c258 }, data: { status: 'locked' } });
    const locked = await request(app).post(`/api/v1/containers/${c258}/receipts`).set('Cookie', cookie).send(resi(SERIAL[2]!, { salesId: ids.said }));
    expect(locked.status).toBe(409);
  });

  it('Alur: Admin tolak → Sales perbaiki (kembali dikirim) → Admin approve mengisi Cek "C"', async () => {
    const { body } = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', await as('said')).send(resi(SERIAL[1]!));
    const reject = await request(app).post(`/api/v1/receipts/${body.id}/reject`).set('Cookie', await as('admin')).send({ reason: 'No HP terpotong' });
    expect(reject.body).toMatchObject({ status: 'rejected', rejectReason: 'No HP terpotong' });

    const fix = await request(app).patch(`/api/v1/receipts/${body.id}`).set('Cookie', await as('said')).send({ recipientPhone: '085524446728' });
    expect(fix.body).toMatchObject({ status: 'submitted', rejectReason: null, recipientPhone: '085524446728' });

    expect((await request(app).post(`/api/v1/receipts/${body.id}/approve`).set('Cookie', await as('said'))).status).toBe(403);
    const ok = await request(app).post(`/api/v1/receipts/${body.id}/approve`).set('Cookie', await as('admin'));
    expect(ok.body).toMatchObject({ status: 'approved', cekNote: 'C' });

    const late = await request(app).patch(`/api/v1/receipts/${body.id}`).set('Cookie', await as('said')).send({ weightKg: 21 });
    expect(late.status).toBe(403);
  });

  it('Mengganti Serial No ke nomor yang sudah dipakai ditolak', async () => {
    const cookie = await as('admin');
    await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie).send(resi(SERIAL[0]!, { salesId: ids.said }));
    const { body } = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie).send(resi(SERIAL[1]!, { salesId: ids.said }));
    const res = await request(app).patch(`/api/v1/receipts/${body.id}`).set('Cookie', cookie).send({ serialNo: SERIAL[0] });
    expect(res.status).toBe(409);
  });

  it('Pindah resi (Plus 1): container asal tercatat, Ket. terisi, Sales tidak boleh memindah', async () => {
    const cookie = await as('admin');
    const { body } = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie).send(resi(SERIAL[0]!, { salesId: ids.said }));
    await request(app).post(`/api/v1/receipts/${body.id}/approve`).set('Cookie', cookie);

    expect((await request(app).post(`/api/v1/receipts/${body.id}/move`).set('Cookie', await as('said')).send({ containerId: c258 })).status).toBe(403);
    expect((await request(app).post(`/api/v1/receipts/${body.id}/move`).set('Cookie', cookie).send({ containerId: c257 })).status).toBe(400);

    const moved = await request(app).post(`/api/v1/receipts/${body.id}/move`).set('Cookie', cookie).send({ containerId: c258 });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ container: { seqNo: SEQ[1] }, carriedFromContainerId: c257, cekNote: `Plus 1 (dari ${SEQ[0]})`, status: 'approved' });
    const raw = await prisma.receipt.findUnique({ where: { id: body.id } });
    expect(raw?.serialNo).toBe(SERIAL[0]); // tetap satu resi, bukan scan ulang
    const log = await prisma.auditLog.findFirst({ where: { entityId: body.id, action: 'receipt.move' } });
    expect(log?.after).toMatchObject({ containerSeqNo: SEQ[1] });
  });

  it('Pindah ke container Locked ditolak', async () => {
    const cookie = await as('admin');
    const { body } = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie).send(resi(SERIAL[0]!, { salesId: ids.said }));
    await prisma.container.update({ where: { id: c258 }, data: { status: 'locked' } });
    expect((await request(app).post(`/api/v1/receipts/${body.id}/move`).set('Cookie', cookie).send({ containerId: c258 })).status).toBe(409);
  });

  it('Rekap per sales: invoice, PCS, Kg; resi ditolak tidak dihitung; Sales hanya melihat miliknya', async () => {
    const cookie = await as('admin');
    await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie).send(resi(SERIAL[0]!, { salesId: ids.said }));
    await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie)
      .send(resi(SERIAL[1]!, { salesId: ids.said, packages: { karton: 2, drum: 1 }, koliTotal: 3, weightKg: 45.5 }));
    const { body: rejected } = await request(app).post(`/api/v1/containers/${c257}/receipts`).set('Cookie', cookie)
      .send(resi(SERIAL[2]!, { salesId: ids.mustofa }));
    await request(app).post(`/api/v1/receipts/${rejected.id}/reject`).set('Cookie', cookie).send({ reason: 'Foto buram' });

    const all = await request(app).get(`/api/v1/containers/${c257}/summary`).set('Cookie', cookie);
    expect(all.body.rows).toEqual([expect.objectContaining({ sales: 'Mr. Said', invoices: 2, pcs: 4, kg: 65.5, pending: 2 })]);
    expect(all.body.total).toMatchObject({ invoices: 2, pcs: 4, kg: 65.5 });

    const own = await request(app).get(`/api/v1/containers/${c257}/summary`).set('Cookie', await as('mustofa'));
    expect(own.body.rows).toEqual([]);
  });

  it('autocomplete wilayah menemukan kab/kota dari ejaan salah', async () => {
    const res = await request(app).get('/api/v1/wilayah/search?q=Tlung%20Agung').set('Cookie', await as('said'));
    expect(res.body[0]).toMatchObject({ shortName: 'Tulungagung', province: 'Jatim' });
  });
});
