/** Audit (F8d) dan statistik scan (F8b) — integrasi ke Postgres lokal. */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { GoogleGateway } from '../src/auth/google.js';
import { signAccess } from '../src/auth/tokens.js';
import { db } from '../src/db.js';
import { loadEnv } from '../src/env.js';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const DOMAIN = 'insight.csm.test';
const SEQ = 970001;
const SERIAL = [94001, 94002, 94003];
const env = loadEnv({ ...process.env, NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000' });
const google: GoogleGateway = { authUrl: () => '', exchange: async () => { throw new Error('x'); } };

describe.skipIf(!HAS_DB)('audit & statistik', () => {
  const prisma = HAS_DB ? db() : (undefined as never);
  const app = createApp({ env, prisma, google });
  let admin = '';
  let said = '';
  let containerId = '';
  let cookie = '';
  const ids: string[] = [];

  async function cleanup() {
    const rs = await prisma.receipt.findMany({ where: { serialNo: { in: SERIAL } } });
    await prisma.receiptPackage.deleteMany({ where: { receiptId: { in: rs.map((r) => r.id) } } });
    await prisma.receipt.deleteMany({ where: { id: { in: rs.map((r) => r.id) } } });
    const c = await prisma.container.findUnique({ where: { seqNo: SEQ } });
    if (c) {
      await prisma.scanAttempt.deleteMany({ where: { containerId: c.id } });
      await prisma.container.delete({ where: { id: c.id } });
    }
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  }

  beforeEach(async () => {
    await cleanup();
    ids.length = 0;
    admin = (await prisma.user.create({ data: { email: `admin@${DOMAIN}`, name: 'Admin', role: 'admin' } })).id;
    said = (await prisma.user.create({ data: { email: `said@${DOMAIN}`, name: 'Said', role: 'sales', displayName: 'Mr. Said Insight' } })).id;
    containerId = (await prisma.container.create({ data: { seqNo: SEQ, status: 'loading', createdBy: admin } })).id;
    cookie = `csm_at=${await signAccess({ sub: admin, role: 'admin', displayName: null }, env.JWT_SECRET)}`;
    const post = (body: object) => request(app).post(`/api/v1/containers/${containerId}/receipts`).set('Cookie', cookie).send({ salesId: said, ...body });
    const full = { senderName: 'A', recipientName: 'B', address: 'Kp. X', passportNo: 'C8060823', recipientPhone: '081249345417' };
    // 1: lengkap tapi tanpa Tujuan → kurang valid · 2: koli ≠ paket → tidak valid · 3: tanpa berat & paket → tidak valid
    ids.push((await post({ serialNo: SERIAL[0], ...full, packages: { koper: 1 }, koliTotal: 1, weightKg: 20 })).body.id);
    ids.push((await post({ serialNo: SERIAL[1], ...full, packages: { drum: 2 }, koliTotal: 3, weightKg: 30 })).body.id);
    ids.push((await post({ serialNo: SERIAL[2] })).body.id);
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('mengelompokkan resi ke tab Tidak valid / Kurang valid dengan alasannya', async () => {
    const bad = await request(app).get(`/api/v1/audit/receipts?category=tidak_valid&container=${containerId}`).set('Cookie', cookie);
    expect(bad.body.counts).toMatchObject({ tidak_valid: 2, kurang_valid: 1 });
    expect(bad.body.rows.map((r: { serialNo: number }) => r.serialNo)).toEqual([SERIAL[2], SERIAL[1]]); // merah terbanyak dulu
    expect(bad.body.rows[1].issues.find((i: { field: string }) => i.field === 'koliTotal').message).toContain('koli di kertas 3');

    const meh = await request(app).get(`/api/v1/audit/receipts?category=kurang_valid&container=${containerId}`).set('Cookie', cookie);
    expect(meh.body.rows).toHaveLength(1);
    expect(meh.body.rows[0].issues).toEqual([expect.objectContaining({ field: 'destCity', level: 'neutral' })]);
  });

  it('filter per field dan tandai sudah diaudit mengeluarkan resi dari antrean', async () => {
    const byField = await request(app).get(`/api/v1/audit/receipts?category=tidak_valid&container=${containerId}&field=weightKg`).set('Cookie', cookie);
    expect(byField.body.rows.map((r: { serialNo: number }) => r.serialNo)).toEqual([SERIAL[2]]);

    expect((await request(app).post(`/api/v1/audit/receipts/${ids[1]}/done`).set('Cookie', cookie)).status).toBe(200);
    const after = await request(app).get(`/api/v1/audit/receipts?category=tidak_valid&container=${containerId}`).set('Cookie', cookie);
    expect(after.body.counts).toMatchObject({ tidak_valid: 1, diaudit: 1 });
    const done = await request(app).get(`/api/v1/audit/receipts?category=diaudit&container=${containerId}`).set('Cookie', cookie);
    expect(done.body.rows[0]).toMatchObject({ serialNo: SERIAL[1], category: 'tidak_valid' }); // kategori asli tetap
  });

  it('statistik: resi unik per container dan duplikat diblokir dihitung terpisah', async () => {
    const dup = await request(app).post(`/api/v1/containers/${containerId}/receipts`).set('Cookie', cookie).send({ serialNo: SERIAL[0], salesId: said });
    expect(dup.status).toBe(409);
    await request(app).post(`/api/v1/receipts/${ids[0]}/approve`).set('Cookie', cookie);

    const stats = await request(app).get('/api/v1/admin/stats?groupBy=container').set('Cookie', cookie);
    const row = stats.body.rows.find((r: { group: string }) => r.group === String(SEQ));
    expect(row).toEqual({ group: String(SEQ), unique: 3, review: 2, approved: 1, duplicates: 1 });

    const bySales = await request(app).get('/api/v1/admin/stats?groupBy=sales').set('Cookie', cookie);
    expect(bySales.body.rows.find((r: { group: string }) => r.group === 'Mr. Said Insight')).toMatchObject({ unique: 3, approved: 1 });

    const sales = `csm_at=${await signAccess({ sub: said, role: 'sales', displayName: null }, env.JWT_SECRET)}`;
    expect((await request(app).get('/api/v1/admin/stats').set('Cookie', sales)).status).toBe(403);
    expect((await request(app).get('/api/v1/audit/receipts').set('Cookie', sales)).status).toBe(403);
  });
});
