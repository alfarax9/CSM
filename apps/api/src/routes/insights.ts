import { Router } from 'express';
import { z } from 'zod';
import { auditCategory, auditIssues } from '@csm/shared';
import { audit } from '../audit.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../http/errors.js';
import { requireRole } from '../http/rbac.js';

const STAFF = requireRole('super_admin', 'admin');

const AuditQuery = z.object({
  category: z.enum(['tidak_valid', 'kurang_valid', 'diaudit']).default('tidak_valid'),
  container: z.uuid().optional(),
  sales: z.uuid().optional(),
  field: z.string().max(40).optional(),
});

const StatsQuery = z.object({
  groupBy: z.enum(['container', 'sales', 'day']).default('container'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Halaman Audit (PRD F8d) dan statistik scan Admin (PRD F8b). */
export function createInsightsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // ─── Audit data tidak valid & kurang valid ──────────────────────────

  router.get('/audit/receipts', STAFF, async (req, res) => {
    const q = AuditQuery.parse(req.query);
    const receipts = await prisma.receipt.findMany({
      where: {
        deletedAt: null,
        status: { not: 'rejected' },
        ...(q.container ? { containerId: q.container } : {}),
        ...(q.sales ? { salesId: q.sales } : {}),
      },
      include: { packages: true, container: true, sales: true, auditor: true },
      orderBy: { createdAt: 'desc' },
    });

    const rows = receipts.map((r) => {
      const pcs = r.packages.reduce((n, p) => n + p.qty, 0);
      const issues = auditIssues({
        koliTotal: r.koliTotal,
        pcs,
        weightKg: r.weightKg === null ? null : Number(r.weightKg),
        destCity: r.destCity,
        hasPassport: r.passportNo !== null,
        hasRecipientPhone: r.recipientPhone !== null,
        address: r.address,
        senderName: r.senderName,
        recipientName: r.recipientName,
      });
      return {
        id: r.id,
        serialNo: r.serialNo,
        container: { id: r.container.id, seqNo: r.container.seqNo },
        sales: r.sales.displayName ?? r.sales.name,
        createdAt: r.createdAt,
        status: r.status,
        category: auditCategory(issues),
        issues,
        auditedAt: r.auditedAt,
        auditedBy: r.auditor?.displayName ?? r.auditor?.name ?? null,
      };
    });

    // Antrean hanya resi yang belum diaudit; kategori asli tidak diubah (PRD F8d).
    const open = rows.filter((r) => r.category !== 'valid' && !r.auditedAt);
    const counts = {
      tidak_valid: open.filter((r) => r.category === 'tidak_valid').length,
      kurang_valid: open.filter((r) => r.category === 'kurang_valid').length,
      diaudit: rows.filter((r) => r.auditedAt).length,
    };
    let list =
      q.category === 'diaudit' ? rows.filter((r) => r.auditedAt) : open.filter((r) => r.category === q.category);
    if (q.field) list = list.filter((r) => r.issues.some((i) => i.field === q.field));
    // Urutan default: masalah merah terbanyak dulu, lalu jumlah masalah (PRD F8d).
    list.sort(
      (a, b) =>
        b.issues.filter((i) => i.level === 'bad').length - a.issues.filter((i) => i.level === 'bad').length ||
        b.issues.length - a.issues.length,
    );
    res.json({ counts, rows: list });
  });

  router.post('/audit/receipts/:id/done', STAFF, async (req, res) => {
    const r = await prisma.receipt.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
    if (!r) throw new AppError('NOT_FOUND', 'Resi tidak ditemukan.');
    const now = new Date();
    await prisma.receipt.update({ where: { id: r.id }, data: { auditedAt: now, auditedBy: req.user!.id } });
    await audit(prisma, { actorId: req.user!.id, action: 'receipt.audited', entity: 'receipt', entityId: r.id, ip: req.ip });
    res.json({ ok: true, auditedAt: now });
  });

  // ─── Statistik scan tanpa duplikat (PRD F8b) ────────────────────────

  router.get('/admin/stats', STAFF, async (req, res) => {
    const q = StatsQuery.parse(req.query);
    const to = q.to ? new Date(`${q.to}T23:59:59.999+07:00`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00+07:00`) : new Date(to.getTime() - 29 * 86_400_000);
    if (from > to) throw new AppError('VALIDATION_FAILED', 'Tanggal awal harus sebelum tanggal akhir.');

    // Kunci & label kelompok untuk resi (r) dan percobaan scan duplikat (a).
    // Per sales dikelompokkan per akun (bukan nama), agar dua sales bernama sama tidak tergabung.
    const key = {
      container: { r: Prisma.sql`c.seq_no::text`, a: Prisma.sql`c.seq_no::text`, label: Prisma.sql`c.seq_no::text` },
      sales: { r: Prisma.sql`u.id::text`, a: Prisma.sql`u.id::text`, label: Prisma.sql`COALESCE(u.display_name, u.name)` },
      day: {
        r: Prisma.sql`to_char(r.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`,
        a: Prisma.sql`to_char(a.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`,
        label: Prisma.sql`NULL`,
      },
    }[q.groupBy];

    // Resi unik: Serial No berbeda di receipts, tidak rejected, tidak dihapus (PRD F8b, §10).
    const receipts = await prisma.$queryRaw<{ grp: string; label: string | null; unik: bigint; review: bigint; approved: bigint }[]>`
      SELECT ${key.r} AS grp, MIN(${key.label}) AS label,
             COUNT(DISTINCT r.serial_no) AS unik,
             COUNT(*) FILTER (WHERE r.status IN ('captured','processing','needs_review','submitted','ready')) AS review,
             COUNT(*) FILTER (WHERE r.status IN ('approved','exported')) AS approved
      FROM receipts r
      JOIN containers c ON c.id = r.container_id
      JOIN users u ON u.id = r.sales_id
      WHERE r.deleted_at IS NULL AND r.status <> 'rejected' AND r.created_at BETWEEN ${from} AND ${to}
      GROUP BY 1`;

    // Duplikat yang diblokir: dari scan_attempts, tidak pernah ditambahkan ke total resi.
    const duplicates = await prisma.$queryRaw<{ grp: string; label: string | null; dup: bigint }[]>`
      SELECT ${key.a} AS grp, MIN(${key.label}) AS label, COUNT(*) AS dup
      FROM scan_attempts a
      JOIN containers c ON c.id = a.container_id
      JOIN users u ON u.id = a.user_id
      WHERE a.result = 'duplicate' AND a.created_at BETWEEN ${from} AND ${to}
      GROUP BY 1`;

    type Row = { group: string; unique: number; review: number; approved: number; duplicates: number };
    const byKey = new Map<string, Row>();
    const row = (g: string, label: string | null) => {
      if (!byKey.has(g)) byKey.set(g, { group: label ?? g, unique: 0, review: 0, approved: 0, duplicates: 0 });
      return byKey.get(g)!;
    };
    for (const r of receipts) Object.assign(row(r.grp, r.label), { unique: Number(r.unik), review: Number(r.review), approved: Number(r.approved) });
    for (const d of duplicates) row(d.grp, d.label).duplicates = Number(d.dup);

    const rows = [...byKey.values()].sort((a, b) =>
      q.groupBy === 'container' ? Number(b.group) - Number(a.group) : q.groupBy === 'day' ? b.group.localeCompare(a.group) : a.group.localeCompare(b.group, 'id'),
    );
    const total = rows.reduce(
      (t, r) => ({ unique: t.unique + r.unique, review: t.review + r.review, approved: t.approved + r.approved, duplicates: t.duplicates + r.duplicates }),
      { unique: 0, review: 0, approved: 0, duplicates: 0 },
    );
    res.json({ groupBy: q.groupBy, from: from.toISOString(), to: to.toISOString(), rows, total });
  });

  return router;
}
