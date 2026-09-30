'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABEL, type Role } from '@csm/shared';
import { Button, ErrorText, Field, Input, Select } from '@/components/ui';
import { apiSend } from '@/lib/client-api';
import type { UserRow } from './page';

function roles(canAssignSuperAdmin: boolean): Role[] {
  return canAssignSuperAdmin ? ['sales', 'admin', 'super_admin'] : ['sales', 'admin'];
}

export function RegisterUserForm({ canAssignSuperAdmin, passwordMode }: { canAssignSuperAdmin: boolean; passwordMode: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className={`grid gap-3 rounded-cell border border-grid bg-surface p-4 md:items-end ${
        passwordMode ? 'md:grid-cols-[1fr_1fr_140px_1fr_1fr_auto]' : 'md:grid-cols-[1fr_1fr_140px_1fr_auto]'
      }`}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        const res = await apiSend('POST', '/admin/users', {
          email: String(f.get('email')),
          name: String(f.get('name')),
          role: String(f.get('role')),
          displayName: String(f.get('displayName') || '') || undefined,
          password: passwordMode ? String(f.get('password')) : undefined,
        });
        setBusy(false);
        if (!res.ok) return setError(res.error ?? '');
        setError('');
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }}
    >
      <Field label={passwordMode ? 'Email' : 'Email Google'}>
        <Input name="email" type="email" required placeholder="nama@perusahaan.co.id" />
      </Field>
      <Field label="Nama lengkap">
        <Input name="name" required />
      </Field>
      <Field label="Role">
        <Select name="role" defaultValue="sales">
          {roles(canAssignSuperAdmin).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nama sales (kolom Ket.)">
        <Input name="displayName" placeholder="Mr. Said" />
      </Field>
      {passwordMode && (
        <Field label="Password awal">
          <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
        </Field>
      )}
      <Button type="submit" disabled={busy}>
        Daftarkan user
      </Button>
      <div className={passwordMode ? 'md:col-span-6' : 'md:col-span-5'}>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}

export function UserActions({
  user,
  canAssignSuperAdmin,
  passwordMode,
}: {
  user: UserRow;
  canAssignSuperAdmin: boolean;
  passwordMode: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');

  async function update(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    const res = await apiSend('PATCH', `/admin/users/${user.id}`, body);
    if (!res.ok) return setError(res.error ?? '');
    setError('');
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-32">
        <Select aria-label={`Role ${user.name}`} value={user.role} onChange={(e) => update({ role: e.target.value })}>
          {roles(canAssignSuperAdmin).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      {user.isActive ? (
        <Button variant="secondary" onClick={() => update({ isActive: false }, `Nonaktifkan ${user.name}? Semua sesinya langsung dicabut.`)}>
          Nonaktifkan
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => update({ isActive: true })}>
          Aktifkan
        </Button>
      )}
      {passwordMode && (
        <Button
          variant="secondary"
          onClick={() => {
            const password = window.prompt(`Password baru untuk ${user.email} (minimal 8 karakter). Semua sesinya akan dicabut.`);
            if (password) update({ password });
          }}
        >
          Atur password
        </Button>
      )}
      {!passwordMode && user.googleLinked && (
        <Button variant="secondary" onClick={() => update({ unbindGoogle: true }, `Lepas ikatan akun Google ${user.email}?`)}>
          Lepas Google
        </Button>
      )}
      {error && <span className="text-meta text-bad-ink">{error}</span>}
    </div>
  );
}
