import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Test integrasi (antrian, login) memakai DATABASE_URL dari .env root saat dijalankan lokal.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv) && !process.env.DATABASE_URL) process.loadEnvFile(rootEnv);

export default defineConfig({ test: { fileParallelism: false } });
