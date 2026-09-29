import type { PrismaClient } from '../generated/prisma/client.js';
import type { GoogleClaims } from './google.js';

export type DenyReason = 'not_registered' | 'domain' | 'inactive' | 'email_unverified';

export type LoginDecision =
  | { ok: true; user: { id: string; role: 'super_admin' | 'admin' | 'sales'; displayName: string | null } }
  | { ok: false; reason: DenyReason };

/**
 * Aturan login PRD §3: email terverifikasi, domain Workspace atau whitelist, harus terdaftar,
 * aktif, dan dicocokkan lewat Google `sub` (email hanya dipakai saat login pertama untuk mengikat `sub`).
 */
export async function decideLogin(
  prisma: PrismaClient,
  claims: GoogleClaims,
  allowedDomains: readonly string[],
): Promise<LoginDecision> {
  if (!claims.emailVerified) return { ok: false, reason: 'email_unverified' };

  const domainOk = claims.hostedDomain !== null && allowedDomains.includes(claims.hostedDomain);
  if (!domainOk) {
    const listed = await prisma.emailWhitelist.findUnique({ where: { email: claims.email } });
    if (!listed) return { ok: false, reason: 'domain' };
  }

  let user = await prisma.user.findUnique({ where: { googleSub: claims.sub } });
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });
    // Email sudah terikat ke akun Google lain → jangan buka akses (PRD §3 butir 5).
    if (!byEmail || byEmail.googleSub !== null) return { ok: false, reason: 'not_registered' };
    user = await prisma.user.update({
      where: { id: byEmail.id },
      data: { googleSub: claims.sub, avatarUrl: claims.picture ?? byEmail.avatarUrl },
    });
  }
  if (!user.isActive) return { ok: false, reason: 'inactive' };

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ok: true, user: { id: user.id, role: user.role, displayName: user.displayName } };
}
