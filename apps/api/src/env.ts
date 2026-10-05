import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().default(4000),
    PUBLIC_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    ALLOWED_GOOGLE_DOMAINS: csv,
    JWT_SECRET: z.string().default(''),
    /** Sementara: `password` (email + password). Kembali ke `google` sesuai PRD §3 sebelum go-live. */
    AUTH_MODE: z.enum(['password', 'google']).default('password'),
    /** Enkripsi kolom paspor/HP dan blind index HMAC — dua kunci berbeda (PRD §10). */
    PII_ENCRYPTION_KEY: z.string().default(''),
    PII_BIDX_KEY: z.string().default(''),
    /** Folder foto resi (PRD §9 volume `uploads`). Dev: data/uploads di root repo (sudah di-.gitignore). */
    UPLOADS_DIR: z.string().default(new URL('../../../data/uploads', import.meta.url).pathname),
  })
  .superRefine((env, ctx) => {
    // Di produksi rahasia sesi wajib kuat; di dev/test boleh kosong (diganti nilai sementara).
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_SECRET', 'PII_ENCRYPTION_KEY', 'PII_BIDX_KEY'] as const) {
        if (env[key].length < 32) ctx.addIssue({ code: 'custom', path: [key], message: `${key} minimal 32 karakter di produksi.` });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(source);
  if (env.JWT_SECRET.length < 32) env.JWT_SECRET = 'dev-only-secret-bukan-untuk-produksi-0123456789';
  if (env.PII_ENCRYPTION_KEY.length < 32) env.PII_ENCRYPTION_KEY = 'dev-only-pii-enc-bukan-untuk-produksi-0123456';
  if (env.PII_BIDX_KEY.length < 32) env.PII_BIDX_KEY = 'dev-only-pii-bidx-bukan-untuk-produksi-012345';
  return env;
}

/** Callback OAuth harus sama persis dengan yang didaftarkan di Google Cloud Console. */
export function googleRedirectUri(env: Env): string {
  return new URL('/api/v1/auth/google/callback', env.PUBLIC_URL).toString();
}
