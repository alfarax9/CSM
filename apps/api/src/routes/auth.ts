import { type CookieOptions, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import type { Role } from '@csm/shared';
import { audit } from '../audit.js';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { GoogleGateway } from '../auth/google.js';
import { decideLogin } from '../auth/login.js';
import { COOKIE } from '../auth/session.js';
import {
  ACCESS_TTL_S,
  FLOW_TTL_S,
  REFRESH_TTL_S,
  pkceChallenge,
  randomToken,
  sha256,
  signAccess,
  signFlow,
  verifyFlow,
} from '../auth/tokens.js';
import { dummyHash, verifyPassword } from '../auth/password.js';
import { AppError } from '../http/errors.js';
import { requireRole } from '../http/rbac.js';

export interface AuthDeps {
  prisma: PrismaClient;
  google: GoogleGateway;
  env: Env;
}

/** Halaman awal per role setelah login. */
export function homeFor(_role: Role): string {
  return '/containers';
}

export function createAuthRouter({ prisma, google, env }: AuthDeps): Router {
  const router = Router();
  const secure = env.PUBLIC_URL.startsWith('https://');
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  const redirectTo = (path: string) => new URL(path, env.PUBLIC_URL).toString();

  // PRD §12: rate limit endpoint auth 10/menit/IP.
  const limiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

  async function startSession(res: Response, userId: string, role: Role, displayName: string | null) {
    const access = await signAccess({ sub: userId, role, displayName }, env.JWT_SECRET);
    const refresh = randomToken();
    await prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refresh), expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000) },
    });
    res.cookie(COOKIE.access, access, { ...base, maxAge: ACCESS_TTL_S * 1000 });
    res.cookie(COOKIE.refresh, refresh, { ...base, path: '/api/v1/auth', maxAge: REFRESH_TTL_S * 1000 });
    // Double-submit CSRF untuk /auth/refresh dan /auth/logout (PRD §12); sengaja bisa dibaca JS.
    res.cookie(COOKIE.csrf, randomToken(16), { ...base, httpOnly: false, maxAge: REFRESH_TTL_S * 1000 });
  }

  function requireCsrf(req: Request) {
    const header = req.get('x-csm-csrf');
    if (!header || header !== req.cookies?.[COOKIE.csrf]) {
      throw new AppError('FORBIDDEN', 'Token CSRF tidak valid. Muat ulang halaman.');
    }
  }

  function clearSession(res: Response) {
    res.clearCookie(COOKIE.access, base);
    res.clearCookie(COOKIE.refresh, { ...base, path: '/api/v1/auth' });
    res.clearCookie(COOKIE.csrf, { ...base, httpOnly: false });
  }

  /** Mode login aktif; dipakai halaman login untuk memilih form. */
  router.get('/auth/mode', (_req, res) => {
    res.json({ mode: env.AUTH_MODE });
  });

  // Login email + password — SEMENTARA, hanya saat AUTH_MODE=password.
  const LoginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1).max(200) });
  router.post('/auth/login', limiter, async (req, res) => {
    if (env.AUTH_MODE !== 'password') throw new AppError('FORBIDDEN', 'Login password dinonaktifkan. Gunakan Masuk dengan Google.');
    const { email, password } = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    // Selalu jalankan verifikasi (hash tiruan jika email tidak ada) agar waktu respons tidak membocorkan email terdaftar.
    const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !user.passwordHash || !valid) {
      await audit(prisma, { action: 'login.denied', entity: 'auth', after: { email }, reason: 'password_invalid', ip: req.ip });
      throw new AppError('UNAUTHENTICATED', 'Email atau password salah.');
    }
    if (!user.isActive) {
      await audit(prisma, { action: 'login.denied', entity: 'auth', after: { email }, reason: 'inactive', ip: req.ip });
      throw new AppError('FORBIDDEN', 'Akun Anda sedang dinonaktifkan. Hubungi Admin.');
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await startSession(res, user.id, user.role, user.displayName);
    await audit(prisma, { actorId: user.id, action: 'login.success', entity: 'user', entityId: user.id, reason: 'password', ip: req.ip });
    res.json({ ok: true, redirect: homeFor(user.role) });
  });

  router.get('/auth/google', limiter, async (_req, res) => {
    if (env.AUTH_MODE !== 'google') return res.redirect(redirectTo('/login'));
    if (!env.GOOGLE_CLIENT_ID) return res.redirect(redirectTo('/login?error=not_configured'));
    const flow = { state: randomToken(), nonce: randomToken(), verifier: randomToken(48) };
    res.cookie(COOKIE.flow, await signFlow(flow, env.JWT_SECRET), {
      ...base,
      path: '/api/v1/auth/google',
      maxAge: FLOW_TTL_S * 1000,
    });
    res.redirect(google.authUrl({ state: flow.state, nonce: flow.nonce, codeChallenge: pkceChallenge(flow.verifier) }));
  });

  router.get('/auth/google/callback', limiter, async (req, res) => {
    const flowCookie = req.cookies?.[COOKIE.flow] as string | undefined;
    res.clearCookie(COOKIE.flow, { ...base, path: '/api/v1/auth/google' });
    const flow = flowCookie ? await verifyFlow(flowCookie, env.JWT_SECRET) : null;
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!flow || !code || req.query.state !== flow.state) {
      await audit(prisma, { action: 'login.denied', entity: 'auth', reason: 'state_invalid', ip: req.ip });
      return res.redirect(redirectTo('/login?error=failed'));
    }

    let claims;
    try {
      claims = await google.exchange(code, flow.verifier, flow.nonce);
    } catch (err) {
      await audit(prisma, { action: 'login.denied', entity: 'auth', reason: `google: ${(err as Error).message}`, ip: req.ip });
      return res.redirect(redirectTo('/login?error=failed'));
    }

    const decision = await decideLogin(prisma, claims, env.ALLOWED_GOOGLE_DOMAINS);
    if (!decision.ok) {
      await audit(prisma, {
        action: 'login.denied',
        entity: 'auth',
        after: { email: claims.email },
        reason: decision.reason,
        ip: req.ip,
      });
      return res.redirect(redirectTo(`/login?error=${decision.reason}`));
    }

    const { user } = decision;
    await startSession(res, user.id, user.role, user.displayName);
    await audit(prisma, { actorId: user.id, action: 'login.success', entity: 'user', entityId: user.id, ip: req.ip });
    return res.redirect(redirectTo(homeFor(user.role)));
  });

  router.post('/auth/refresh', limiter, async (req, res) => {
    requireCsrf(req);
    const token = req.cookies?.[COOKIE.refresh] as string | undefined;
    const row = token
      ? await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } })
      : null;
    if (!row || row.revokedAt || row.expiresAt < new Date() || !row.user.isActive) {
      clearSession(res);
      throw new AppError('UNAUTHENTICATED', 'Sesi berakhir. Silakan masuk lagi.');
    }
    // Rotasi: token lama dicabut, token baru diterbitkan.
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await startSession(res, row.user.id, row.user.role, row.user.displayName);
    res.json({ ok: true });
  });

  /**
   * Perpanjang sesi lewat navigasi browser (dipakai middleware web saat access token habis),
   * lalu kembali ke halaman asal. `next` hanya boleh path relatif di aplikasi ini.
   */
  router.get('/auth/renew', limiter, async (req, res) => {
    const next = typeof req.query.next === 'string' && /^\/(?!\/)/.test(req.query.next) ? req.query.next : '/containers';
    const token = req.cookies?.[COOKIE.refresh] as string | undefined;
    const row = token
      ? await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } })
      : null;
    if (!row || row.revokedAt || row.expiresAt < new Date() || !row.user.isActive) {
      clearSession(res);
      return res.redirect(redirectTo('/login'));
    }
    await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await startSession(res, row.user.id, row.user.role, row.user.displayName);
    return res.redirect(redirectTo(next));
  });

  router.post('/auth/logout', async (req, res) => {
    requireCsrf(req);
    const token = req.cookies?.[COOKIE.refresh] as string | undefined;
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (req.user) await audit(prisma, { actorId: req.user.id, action: 'logout', entity: 'user', entityId: req.user.id, ip: req.ip });
    clearSession(res);
    res.json({ ok: true });
  });

  router.get('/me', requireRole('super_admin', 'admin', 'sales'), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.isActive) throw new AppError('UNAUTHENTICATED', 'Akun tidak aktif.');
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    });
  });

  return router;
}
