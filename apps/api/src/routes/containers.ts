import { Router } from 'express';
import { z } from 'zod';
import {
  BOX_NO_PATTERN,
  CONTAINER_STATUSES,
  canTransitionContainer,
  isContainerUnlock,
  normalizeBoxNo,
} from '@csm/shared';
import { audit } from '../audit.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../http/errors.js';
import { requireRole } from '../http/rbac.js';

const RETENTION_DAYS = 30; // PRD §12: foto & data pribadi dihapus 30 hari setelah Closed

const boxNo = z
  .string()
  .transform(normalizeBoxNo)
  .refine((v) => BOX_NO_PATTERN.test(v), 'Nomor box harus 4 huruf + 7 angka, mis. TXGU 7181980.');

const CreateSchema = z.object({
  seqNo: z.coerce.number().int().positive(),
  boxNo: boxNo.optional(),
  loadingDate: z.iso.date().optional(),
});

const UpdateSchema = z
  .object({
    boxNo: boxNo.nullable().optional(),
    loadingDate: z.iso.date().nullable().optional(),
    status: z.enum(CONTAINER_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Tidak ada perubahan.');

/** Manajemen container (PRD F4, §11 `/containers`). */
export function createContainersRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/containers', requireRole('super_admin', 'admin', 'sales'), async (req, res) => {
    const containers = await prisma.container.findMany({ orderBy: { seqNo: 'desc' } });
    const counts = await prisma.receipt.groupBy({
      by: ['containerId'],
      where: {
        deletedAt: null,
        status: { not: 'rejected' },
        // Sales hanya melihat hitungan resi miliknya (kepemilikan dicek di query, PRD §11).
        ...(req.user!.role === 'sales' ? { salesId: req.user!.id } : {}),
      },
      _count: { _all: true },
    });
    const byContainer = new Map(counts.map((c) => [c.containerId, c._count._all]));
    res.json(
      containers.map((c) => ({
        id: c.id,
        seqNo: c.seqNo,
        boxNo: c.boxNo,
        loadingDate: c.loadingDate?.toISOString().slice(0, 10) ?? null,
        status: c.status,
        lockedAt: c.lockedAt,
        closedAt: c.closedAt,
        purgeAt: c.purgeAt,
        receipts: byContainer.get(c.id) ?? 0,
      })),
    );
  });

  router.post('/containers', requireRole('super_admin', 'admin'), async (req, res) => {
    const input = CreateSchema.parse(req.body);
    const exists = await prisma.container.findUnique({ where: { seqNo: input.seqNo } });
    if (exists) throw new AppError('VALIDATION_FAILED', `Container ${input.seqNo} sudah ada.`);
    const c = await prisma.container.create({
      data: {
        seqNo: input.seqNo,
        boxNo: input.boxNo ?? null,
        loadingDate: input.loadingDate ? new Date(input.loadingDate) : null,
        createdBy: req.user!.id,
      },
    });
    await audit(prisma, {
      actorId: req.user!.id,
      action: 'container.create',
      entity: 'container',
      entityId: c.id,
      after: { seqNo: c.seqNo, boxNo: c.boxNo },
      ip: req.ip,
    });
    res.status(201).json({ id: c.id });
  });

  router.patch('/containers/:id', requireRole('super_admin', 'admin'), async (req, res) => {
    const input = UpdateSchema.parse(req.body);
    const c = await prisma.container.findUnique({ where: { id: String(req.params.id) } });
    if (!c) throw new AppError('NOT_FOUND', 'Container tidak ditemukan.');
    if (c.purgedAt) throw new AppError('CONTAINER_CLOSED', 'Container sudah dianonimkan dan tidak bisa diubah.');

    const data: Parameters<typeof prisma.container.update>[0]['data'] = {};
    if (input.boxNo !== undefined) data.boxNo = input.boxNo;
    if (input.loadingDate !== undefined) data.loadingDate = input.loadingDate ? new Date(input.loadingDate) : null;
    if (input.status && input.status !== c.status) {
      if (!canTransitionContainer(c.status, input.status)) {
        throw new AppError('VALIDATION_FAILED', `Status tidak bisa berpindah dari ${c.status} ke ${input.status}.`);
      }
      if (isContainerUnlock(c.status, input.status) && req.user!.role !== 'super_admin') {
        throw new AppError('FORBIDDEN', 'Unlock container hanya bisa dilakukan Super Admin.');
      }
      data.status = input.status;
      if (input.status === 'locked') data.lockedAt = new Date();
      if (input.status === 'loading') data.lockedAt = null;
      if (input.status === 'closed') {
        const now = new Date();
        data.closedAt = now;
        data.purgeAt = new Date(now.getTime() + RETENTION_DAYS * 86_400_000);
      }
    }

    const updated = await prisma.container.update({ where: { id: c.id }, data });
    await audit(prisma, {
      actorId: req.user!.id,
      action: input.status && input.status !== c.status ? `container.status.${input.status}` : 'container.update',
      entity: 'container',
      entityId: c.id,
      before: { status: c.status, boxNo: c.boxNo },
      after: { status: updated.status, boxNo: updated.boxNo },
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  return router;
}
