import type { PrismaClient } from './generated/prisma/client.js';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: object | null;
  after?: object | null;
  reason?: string | null;
  ip?: string | null;
}

/** audit_logs append-only (PRD §12). */
export async function audit(prisma: PrismaClient, e: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: e.actorId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: e.before ?? undefined,
      after: e.after ?? undefined,
      reason: e.reason ?? null,
      ip: e.ip ?? null,
    },
  });
}
