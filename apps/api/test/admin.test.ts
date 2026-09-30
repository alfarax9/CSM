/** Kelola user (F8a) dan container (F4) — integrasi ke Postgres lokal. */
import type { Role } from '@csm/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { GoogleGateway } from '../src/auth/google.js';
import { signAccess } from '../src/auth/tokens.js';
import { db } from '../src/db.js';
import { loadEnv } from '../src/env.js';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const DOMAIN = 'admin.csm.test';
const SEQ = [990001, 990002];
const env = loadEnv({ ...process.env, NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000' });
const google: GoogleGateway = { authUrl: () => '', exchange: async () => { throw new Error('tidak dipakai'); } };

describe.skipIf(!HAS_DB)('admin: user & container', () => {
  const prisma = HAS_DB ? db() : (undefined as never);
  const app = createApp({ env, prisma, google });
  const ids: Record<string, string> = {};

  async function as(role: 'sa' | 'admin' | 'sales') {
    const r: Record<string, Role> = { sa: 'super_admin', admin: 'admin', sales: 'sales' };
    return `csm_at=${await signAccess({ sub: ids[role]!, role: r[role]!, displayName: null }, env.JWT_SECRET)}`;
  }

  async function cleanup() {
    const cs = await prisma.container.findMany({ where: { seqNo: { in: SEQ } } });
    await prisma.container.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
    const us = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: us.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: us.map((u) => u.id) } } });
  }

  beforeEach(async () => {
    await cleanup();
    for (const [key, role] of [['sa', 'super_admin'], ['admin', 'admin'], ['sales', 'sales']] as const) {
      ids[key] = (await prisma.user.create({ data: { email: `${key}@${DOMAIN}`, name: key, role } })).id;
    }
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('Admin mendaftarkan Sales, tapi tidak boleh memberi role Super Admin', async () => {
    const ok = await request(app).post('/api/v1/admin/users').set('Cookie', await as('admin'))
      .send({ email: `said@${DOMAIN}`, name: 'Said', role: 'sales', displayName: 'Mr. Said' });
    expect(ok.status).toBe(201);
    const no = await request(app).post('/api/v1/admin/users').set('Cookie', await as('admin'))
      .send({ email: `x@${DOMAIN}`, name: 'X', role: 'super_admin' });
    expect(no.status).toBe(403);
  });

  it('Admin tidak bisa mengubah akun Super Admin; Sales tidak bisa kelola user', async () => {
    const res = await request(app).patch(`/api/v1/admin/users/${ids.sa}`).set('Cookie', await as('admin')).send({ isActive: false });
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/v1/admin/users').set('Cookie', await as('sales'))).status).toBe(403);
  });

  it('menonaktifkan user mencabut semua refresh token-nya', async () => {
    await prisma.refreshToken.create({ data: { userId: ids.sales!, tokenHash: `uji-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    const res = await request(app).patch(`/api/v1/admin/users/${ids.sales}`).set('Cookie', await as('admin')).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: ids.sales!, revokedAt: null } })).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { action: 'user.update', entityId: ids.sales }, orderBy: { id: 'desc' } });
    expect(log?.after).toMatchObject({ isActive: false });
  });

  it('tidak bisa menonaktifkan akun sendiri', async () => {
    const res = await request(app).patch(`/api/v1/admin/users/${ids.admin}`).set('Cookie', await as('admin')).send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it('container: buat, nomor box dinormalisasi, nomor urut unik', async () => {
    const res = await request(app).post('/api/v1/containers').set('Cookie', await as('admin'))
      .send({ seqNo: SEQ[0], boxNo: 'txgu7181980', loadingDate: '2026-08-28' });
    expect(res.status).toBe(201);
    const c = await prisma.container.findUnique({ where: { seqNo: SEQ[0] } });
    expect(c?.boxNo).toBe('TXGU 7181980');
    const dup = await request(app).post('/api/v1/containers').set('Cookie', await as('admin')).send({ seqNo: SEQ[0] });
    expect(dup.status).toBe(400);
    const bad = await request(app).post('/api/v1/containers').set('Cookie', await as('admin')).send({ seqNo: SEQ[1], boxNo: 'ABC' });
    expect(bad.status).toBe(400);
    expect((await request(app).post('/api/v1/containers').set('Cookie', await as('sales')).send({ seqNo: SEQ[1] })).status).toBe(403);
  });

  it('container: siklus status, unlock hanya Super Admin, Closed mengisi tanggal retensi', async () => {
    const { body } = await request(app).post('/api/v1/containers').set('Cookie', await as('admin')).send({ seqNo: SEQ[1] });
    const patch = async (who: 'sa' | 'admin', status: string) =>
      request(app).patch(`/api/v1/containers/${body.id}`).set('Cookie', await as(who)).send({ status });

    expect((await patch('admin', 'locked')).status).toBe(400); // draft → locked melompat
    expect((await patch('admin', 'loading')).status).toBe(200);
    expect((await patch('admin', 'locked')).status).toBe(200);
    expect((await patch('admin', 'loading')).status).toBe(403); // unlock oleh Admin
    expect((await patch('sa', 'loading')).status).toBe(200); // unlock oleh Super Admin
    for (const s of ['locked', 'shipped', 'unloading', 'closed']) expect((await patch('admin', s)).status).toBe(200);

    const c = await prisma.container.findUnique({ where: { id: body.id } });
    expect(c?.status).toBe('closed');
    const days = (c!.purgeAt!.getTime() - c!.closedAt!.getTime()) / 86_400_000;
    expect(days).toBe(30);

    const list = await request(app).get('/api/v1/containers').set('Cookie', await as('sales'));
    expect(list.status).toBe(200);
    expect(list.body.find((x: { seqNo: number }) => x.seqNo === SEQ[1])?.status).toBe('closed');
  });
});
