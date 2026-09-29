import type { PrismaClient } from '../generated/prisma/client.js';

/** Tipe job di tabel `jobs` (PRD §9, §12). */
export type JobType = 'extract-receipt' | 'rasterize-pdf' | 'generate-export' | 'retention-purge';

/** Masukkan job lalu bangunkan worker Python lewat NOTIFY jobs_new. */
export async function enqueueJob(
  prisma: PrismaClient,
  type: JobType,
  payload: Record<string, unknown>,
  priority = 100,
): Promise<string> {
  const job = await prisma.job.create({ data: { type, payload: payload as object, priority } });
  await prisma.$executeRaw`SELECT pg_notify('jobs_new', ${type})`;
  return job.id;
}
