import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 tidak memuat .env otomatis. .env ada di root monorepo.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` tidak butuh koneksi; migrate/studio butuh DATABASE_URL asli.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://unset@localhost:5432/unset' },
});
