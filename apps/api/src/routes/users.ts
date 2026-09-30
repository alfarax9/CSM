import { Router } from 'express';
import { z } from 'zod';
import { ASSIGNABLE_ROLES, ROLES, type Role } from '@csm/shared';
import { audit } from '../audit.js';
import { PASSWORD_MIN_LENGTH, hashPassword } from '../auth/password.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../http/errors.js';
import { requireRole } from '../http/rbac.js';

const RegisterSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
  displayName: z.string().trim().max(60).optional(),
  /** Sementara (AUTH_MODE=password). */
  password: z.string().min(PASSWORD_MIN_LENGTH, `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`).max(200).optional(),
});

const UpdateSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    displayName: z.string().trim().max(60).nullable().optional(),
    isActive: z.boolean().optional(),
    unbindGoogle: z.literal(true).optional(),
    password: z.string().min(PASSWORD_MIN_LENGTH, `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan.');

/** Kelola seluruh user (PRD F8a, §11 `/admin/users`). Admin tidak bisa menyentuh akun/role Super Admin. */
export function createUsersRouter(prisma: PrismaClient): Router {
  const router = Router();
  const staff = requireRole('super_admin', 'admin');

  function assertCanAssign(actor: Role, role: Role) {
    if (!ASSIGNABLE_ROLES[actor].includes(role)) {
      throw new AppError('FORBIDDEN', 'Anda tidak boleh memberi role ini.');
    }
  }

  router.get('/admin/users', staff, async (_req, res) => {
    const [users, counts] = await Promise.all([
      prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }] }),
      // Jumlah resi unik yang di-scan per sales (PRD F8a/F8b: tanpa rejected & terhapus).
      prisma.receipt.groupBy({
        by: ['salesId'],
        where: { deletedAt: null, status: { not: 'rejected' } },
        _count: { _all: true },
      }),
    ]);
    const bySales = new Map(counts.map((c) => [c.salesId, c._count._all]));
    res.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        displayName: u.displayName,
        isActive: u.isActive,
        googleLinked: u.googleSub !== null,
        hasPassword: u.passwordHash !== null,
        lastLoginAt: u.lastLoginAt,
        uniqueReceipts: bySales.get(u.id) ?? 0,
      })),
    );
  });

  router.post('/admin/users', staff, async (req, res) => {
    const input = RegisterSchema.parse(req.body);
    assertCanAssign(req.user!.role, input.role);
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new AppError('VALIDATION_FAILED', `Email ${input.email} sudah terdaftar.`);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        displayName: input.displayName || null,
        passwordHash: input.password ? await hashPassword(input.password) : null,
      },
    });
    await audit(prisma, {
      actorId: req.user!.id,
      action: 'user.register',
      entity: 'user',
      entityId: user.id,
      after: { email: user.email, role: user.role },
      ip: req.ip,
    });
    res.status(201).json({ id: user.id });
  });

  router.patch('/admin/users/:id', staff, async (req, res) => {
    const input = UpdateSchema.parse(req.body);
    const actor = req.user!;
    const target = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
    if (!target) throw new AppError('NOT_FOUND', 'User tidak ditemukan.');
    if (actor.role !== 'super_admin' && target.role === 'super_admin') {
      throw new AppError('FORBIDDEN', 'Akun Super Admin hanya bisa diubah oleh Super Admin.');
    }
    if (input.role) assertCanAssign(actor.role, input.role);
    if (target.id === actor.id && (input.isActive === false || (input.role && input.role !== target.role))) {
      throw new AppError('FORBIDDEN', 'Anda tidak bisa menonaktifkan atau mengubah role akun sendiri.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: target.id },
        data: {
          role: input.role,
          displayName: input.displayName,
          isActive: input.isActive,
          googleSub: input.unbindGoogle ? null : undefined,
          passwordHash: input.password ? await hashPassword(input.password) : undefined,
        },
      });
      // Nonaktif, lepas ikatan Google, atau ganti password → semua sesi dicabut (PRD §3 butir 8).
      if (input.isActive === false || input.unbindGoogle || input.password) {
        await tx.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return u;
    });
    await audit(prisma, {
      actorId: actor.id,
      action: 'user.update',
      entity: 'user',
      entityId: target.id,
      before: { role: target.role, displayName: target.displayName, isActive: target.isActive, googleLinked: !!target.googleSub },
      after: {
        role: updated.role,
        displayName: updated.displayName,
        isActive: updated.isActive,
        googleLinked: !!updated.googleSub,
        ...(input.password ? { passwordChanged: true } : {}),
      },
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  return router;
}
