/**
 * Buat akun awal untuk login email + password (sementara, AUTH_MODE=password).
 * Kredensial dibaca dari .env (tidak pernah masuk repo):
 *   SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD / SEED_SUPER_ADMIN_NAME
 *   SEED_ADMIN_EMAIL       / SEED_ADMIN_PASSWORD       / SEED_ADMIN_NAME
 * Idempoten: akun yang sudah punya password tidak ditimpa (password yang diganti lewat UI tetap berlaku).
 *   npm run users:seed -w @csm/api
 */
import type { Role } from '@csm/shared';
import { audit } from '../src/audit.js';
import { PASSWORD_MIN_LENGTH, hashPassword } from '../src/auth/password.js';
import { db } from '../src/db.js';

const SEEDS: { prefix: string; role: Role; fallbackName: string }[] = [
  { prefix: 'SEED_SUPER_ADMIN', role: 'super_admin', fallbackName: 'Super Admin' },
  { prefix: 'SEED_ADMIN', role: 'admin', fallbackName: 'Admin' },
];

const prisma = db();
for (const { prefix, role, fallbackName } of SEEDS) {
  const email = process.env[`${prefix}_EMAIL`]?.trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) continue;
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`${prefix}_PASSWORD minimal ${PASSWORD_MIN_LENGTH} karakter — dilewati.`);
    continue;
  }
  const name = process.env[`${prefix}_NAME`]?.trim() || fallbackName;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash) {
    console.log(`${email}: sudah ada (${existing.role}), password tidak diubah.`);
    continue;
  }
  const passwordHash = await hashPassword(password);
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, isActive: true } })
    : await prisma.user.create({ data: { email, name, role, passwordHash } });
  await audit(prisma, { action: 'user.seed', entity: 'user', entityId: user.id, after: { email, role: user.role } });
  console.log(`${email}: ${existing ? 'password diatur' : 'dibuat'} (${user.role}).`);
}
await prisma.$disconnect();
