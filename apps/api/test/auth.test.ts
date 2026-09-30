/** Integrasi alur login Google (PRD §3) ke Postgres lokal. Dilewati jika DATABASE_URL tidak di-set. */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { GoogleClaims, GoogleGateway } from '../src/auth/google.js';
import { db } from '../src/db.js';
import { loadEnv } from '../src/env.js';

const HAS_DB = Boolean(process.env.DATABASE_URL);
const DOMAIN = 'uji.csm.test';
const env = loadEnv({ ...process.env, NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000', ALLOWED_GOOGLE_DOMAINS: DOMAIN, GOOGLE_CLIENT_ID: 'uji', AUTH_MODE: 'google' });

/** Google tiruan: kode → klaim; memeriksa nonce seperti gateway asli. */
function fakeGoogle(byCode: Record<string, GoogleClaims & { nonce?: string }>): GoogleGateway & { lastNonce?: string } {
  const g: GoogleGateway & { lastNonce?: string } = {
    authUrl: ({ state, nonce, codeChallenge }) => {
      g.lastNonce = nonce;
      return `https://accounts.google.test/auth?state=${state}&code_challenge=${codeChallenge}`;
    },
    exchange: async (code, verifier, nonce) => {
      if (verifier.length < 43) throw new Error('verifier PKCE terlalu pendek');
      if (nonce !== g.lastNonce) throw new Error('nonce tidak cocok');
      const c = byCode[code];
      if (!c) throw new Error('kode tidak dikenal');
      return c;
    },
  };
  return g;
}

const claims = (email: string, sub: string, extra: Partial<GoogleClaims> = {}): GoogleClaims => ({
  sub,
  email,
  emailVerified: true,
  hostedDomain: email.endsWith(`@${DOMAIN}`) ? DOMAIN : null,
  name: 'Uji',
  picture: null,
  ...extra,
});

describe.skipIf(!HAS_DB)('login Google', () => {
  const prisma = HAS_DB ? db() : (undefined as never);
  const google = fakeGoogle({
    admin: claims(`admin@${DOMAIN}`, 'sub-admin'),
    asing: claims(`orang@${DOMAIN}`, 'sub-asing'),
    gmail: claims('pribadi@gmail.com', 'sub-gmail'),
    nonaktif: claims(`nonaktif@${DOMAIN}`, 'sub-nonaktif'),
    belumverif: claims(`admin@${DOMAIN}`, 'sub-admin', { emailVerified: false }),
  });
  const app = () => createApp({ env, prisma, google });

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  }

  beforeAll(cleanup);
  beforeEach(async () => {
    await cleanup();
    await prisma.user.create({ data: { email: `admin@${DOMAIN}`, name: 'Admin Uji', role: 'admin', displayName: 'Admin Gudang' } });
    await prisma.user.create({ data: { email: `nonaktif@${DOMAIN}`, name: 'Nonaktif', role: 'sales', isActive: false } });
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  /** Jalankan /auth/google lalu callback dengan `code`; kembalikan response callback. */
  async function login(agent: ReturnType<typeof request.agent>, code: string, stateOverride?: string) {
    const start = await agent.get('/api/v1/auth/google');
    expect(start.status).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    return agent.get(`/api/v1/auth/google/callback?code=${code}&state=${stateOverride ?? state}`);
  }

  it('user terdaftar masuk, google_sub terikat, /me mengembalikan profil', async () => {
    const agent = request.agent(app());
    const res = await login(agent, 'admin');
    expect(res.headers.location).toBe('http://localhost:3000/containers');
    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: `admin@${DOMAIN}`, role: 'admin', displayName: 'Admin Gudang' });
    const user = await prisma.user.findUnique({ where: { email: `admin@${DOMAIN}` } });
    expect(user?.googleSub).toBe('sub-admin');
  });

  it.each([
    ['asing', 'not_registered'],
    ['gmail', 'domain'],
    ['nonaktif', 'inactive'],
    ['belumverif', 'email_unverified'],
  ])('menolak %s dengan alasan %s dan mencatat audit', async (code, reason) => {
    const res = await login(request.agent(app()), code);
    expect(res.headers.location).toBe(`http://localhost:3000/login?error=${reason}`);
    const log = await prisma.auditLog.findFirst({ where: { action: 'login.denied', reason }, orderBy: { id: 'desc' } });
    expect(log).not.toBeNull();
  });

  it('gmail di whitelist boleh masuk jika terdaftar', async () => {
    await prisma.emailWhitelist.upsert({ where: { email: 'pribadi@gmail.com' }, update: {}, create: { email: 'pribadi@gmail.com', createdBy: '00000000-0000-0000-0000-000000000000' } });
    const u = await prisma.user.upsert({ where: { email: 'pribadi@gmail.com' }, update: { googleSub: null }, create: { email: 'pribadi@gmail.com', name: 'Sales Gmail', role: 'sales' } });
    try {
      const res = await login(request.agent(app()), 'gmail');
      expect(res.headers.location).toBe('http://localhost:3000/containers');
    } finally {
      await prisma.refreshToken.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
      await prisma.emailWhitelist.delete({ where: { email: 'pribadi@gmail.com' } });
    }
  });

  it('tanpa GOOGLE_CLIENT_ID kembali ke halaman login dengan pesan', async () => {
    const res = await request(createApp({ env: { ...env, GOOGLE_CLIENT_ID: '' }, prisma, google })).get('/api/v1/auth/google');
    expect(res.headers.location).toBe('http://localhost:3000/login?error=not_configured');
  });

  it('state yang tidak cocok ditolak', async () => {
    const res = await login(request.agent(app()), 'admin', 'state-palsu');
    expect(res.headers.location).toBe('http://localhost:3000/login?error=failed');
  });

  it('renew memperpanjang sesi dan hanya mengarahkan ke path internal', async () => {
    const agent = request.agent(app());
    await login(agent, 'admin');
    const ok = await agent.get('/api/v1/auth/renew?next=/admin/users');
    expect(ok.headers.location).toBe('http://localhost:3000/admin/users');
    const evil = await agent.get('/api/v1/auth/renew?next=//evil.example');
    expect(evil.headers.location).toBe('http://localhost:3000/containers');
    const anon = await request(app()).get('/api/v1/auth/renew?next=/admin/users');
    expect(anon.headers.location).toBe('http://localhost:3000/login');
  });

  it('refresh merotasi token dan butuh CSRF; logout mencabut sesi', async () => {
    const agent = request.agent(app());
    const res = await login(agent, 'admin');
    const csrf = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('csm_csrf='))!.split(';')[0]!.split('=')[1]!;

    expect((await agent.post('/api/v1/auth/refresh')).status).toBe(403);
    const refreshed = await agent.post('/api/v1/auth/refresh').set('x-csm-csrf', csrf);
    expect(refreshed.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email: `admin@${DOMAIN}` } });
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user!.id } });
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((t) => t.revokedAt === null)).toHaveLength(1);

    const newCsrf = (refreshed.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('csm_csrf='))!.split(';')[0]!.split('=')[1]!;
    expect((await agent.post('/api/v1/auth/logout').set('x-csm-csrf', newCsrf)).status).toBe(200);
    const after = await prisma.refreshToken.findMany({ where: { userId: user!.id, revokedAt: null } });
    expect(after).toHaveLength(0);
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });
});
