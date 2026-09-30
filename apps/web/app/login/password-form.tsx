'use client';

import { useState } from 'react';
import { Button, ErrorText, Field, Input } from '@/components/ui';

/** Login email + password — sementara, selama AUTH_MODE=password. */
export function PasswordLoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-6 grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
        });
        const data = (await res.json().catch(() => null)) as { redirect?: string; error?: { message?: string } } | null;
        setBusy(false);
        if (res.ok && data?.redirect) return window.location.assign(data.redirect);
        setError(data?.error?.message ?? 'Login gagal. Coba lagi.');
      }}
    >
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="h-9">
        {busy ? 'Memeriksa…' : 'Masuk'}
      </Button>
    </form>
  );
}
