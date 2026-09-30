const REASONS: Record<string, string> = {
  not_registered: 'Akun belum terdaftar. Hubungi Admin.',
  domain: 'Akun Google ini bukan akun perusahaan dan tidak ada di whitelist.',
  inactive: 'Akun Anda sedang dinonaktifkan. Hubungi Admin.',
  email_unverified: 'Email akun Google ini belum terverifikasi. Verifikasi dulu di pengaturan akun Google.',
  failed: 'Login terputus atau kedaluwarsa. Klik "Masuk dengan Google" sekali lagi.',
  not_configured: 'Login Google belum dikonfigurasi di server. Hubungi Super Admin.',
};

import { PasswordLoginForm } from './password-form';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

async function authMode(): Promise<'password' | 'google'> {
  try {
    const res = await fetch(`${API}/api/v1/auth/mode`, { cache: 'no-store' });
    return ((await res.json()) as { mode: 'password' | 'google' }).mode;
  } catch {
    return 'password';
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? (REASONS[error] ?? 'Login gagal. Coba lagi.') : null;
  const mode = await authMode();

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <section className="w-full max-w-sm rounded-dialog border border-grid bg-surface p-6">
        <h1 className="text-page font-semibold">Masuk ke CSM</h1>
        <p className="mt-1 text-ink-muted">
          {mode === 'google'
            ? 'Pakai akun Google perusahaan yang sudah didaftarkan Admin.'
            : 'Masuk dengan email dan password yang didaftarkan Admin.'}
        </p>
        {message && (
          <p role="alert" className="mt-4 rounded-cell bg-bad px-3 py-2 text-bad-ink">
            {message}
          </p>
        )}
        {mode === 'password' ? (
          <PasswordLoginForm />
        ) : (
          <a
            href="/api/v1/auth/google"
            className="mt-6 flex h-9 items-center justify-center rounded-button bg-green-600 font-semibold text-white hover:bg-green-700"
          >
            Masuk dengan Google
          </a>
        )}
      </section>
    </main>
  );
}
