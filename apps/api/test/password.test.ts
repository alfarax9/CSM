/** Login email + password sementara (AUTH_MODE=password) — integrasi ke Postgres lokal. */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { GoogleGateway } from '../src/auth/google.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { signAccess } from '../src/auth/tokens.js';
import { db } from '../src/db.js';
import { loadEnv } from '../src/env.js';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const DOMAIN = 'pw.csm.test';
const PW = 'rahasia-uji-123';
const env = loadEnv({ ...process.env, NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000', AUTH_MODE: 'password' });
const google: GoogleGateway = { authUrl: () => 'https://google.test', exchange: async () => { throw new Error('x'); } };

describe('hash password', () => {
  it('menyimpan hash scrypt, bukan password asli', async () => {
    const h = await hashPassword(PW);
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain(PW);
    expect(await verifyPassword(PW, h)).toBe(true);
    expect(await verifyPassword('salah', h)).toBe(false);
  });
});

describe.skipIf(!HAS_DB)('login password', () => {
  const prisma = HAS_DB ? db() : (undefined as never);
  const app = createApp({ env, prisma, google });
  let adminId = '';

  async function cleanup() {
    const us = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: us.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: us.map((u) => u.id) } } });
  }
  beforeEach(async () => {
    await cleanup();
    const hash = await hashPassword(PW);
    adminId = (await prisma.user.create({ data: { email: `admin@${DOMAIN}`, name: 'Admin', role: 'admin', passwordHash: hash } })).id;
    await prisma.user.create({ data: { email: `off@${DOMAIN}`, name: 'Off', role: 'sales', passwordHash: hash, isActive: false } });
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const login = (agent: ReturnType<typeof request.agent> | ReturnType<typeof request>, email: string, password: string) =>
    agent.post('/api/v1/auth/login').send({ email, password });

  it('mode login diumumkan ke web', async () => {
    expect((await request(app).get('/api/v1/auth/mode')).body).toEqual({ mode: 'password' });
  });

  it('login benar membuat sesi; email tidak peka huruf besar', async () => {
    const agent = request.agent(app);
    const res = await login(agent, `ADMIN@${DOMAIN}`, PW);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, redirect: '/containers' });
    const me = await agent.get('/api/v1/me');
    expect(me.body).toMatchObject({ email: `admin@${DOMAIN}`, role: 'admin' });
  });

  it('password salah dan email tak terdaftar mendapat pesan yang sama', async () => {
    const wrong = await login(request(app), `admin@${DOMAIN}`, 'salah-sekali');
    const unknown = await login(request(app), `siapa@${DOMAIN}`, PW);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    const log = await prisma.auditLog.findFirst({ where: { action: 'login.denied', reason: 'password_invalid' }, orderBy: { id: 'desc' } });
    expect(log).not.toBeNull();
  });

  it('akun nonaktif ditolak', async () => {
    expect((await login(request(app), `off@${DOMAIN}`, PW)).status).toBe(403);
  });

  it('login Google dimatikan di mode password', async () => {
    expect((await request(app).get('/api/v1/auth/google')).headers.location).toBe('http://localhost:3000/login');
  });

  it('Admin mendaftarkan Sales dengan password → Sales bisa login; reset password mencabut sesi', async () => {
    const cookie = `csm_at=${await signAccess({ sub: adminId, role: 'admin', displayName: null }, env.JWT_SECRET)}`;
    const short = await request(app).post('/api/v1/admin/users').set('Cookie', cookie)
      .send({ email: `sales@${DOMAIN}`, name: 'Sales', role: 'sales', password: 'pendek' });
    expect(short.status).toBe(400);
    const created = await request(app).post('/api/v1/admin/users').set('Cookie', cookie)
      .send({ email: `sales@${DOMAIN}`, name: 'Sales', role: 'sales', password: PW });
    expect(created.status).toBe(201);

    const agent = request.agent(app);
    expect((await login(agent, `sales@${DOMAIN}`, PW)).status).toBe(200);
    const reset = await request(app).patch(`/api/v1/admin/users/${created.body.id}`).set('Cookie', cookie).send({ password: 'password-baru-9' });
    expect(reset.status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: created.body.id, revokedAt: null } })).toBe(0);
    expect((await login(request(app), `sales@${DOMAIN}`, PW)).status).toBe(401);
    expect((await login(request(app), `sales@${DOMAIN}`, 'password-baru-9')).status).toBe(200);
  });
});
