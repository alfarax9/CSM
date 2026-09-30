import { ROLE_LABEL } from '@csm/shared';
import { Grid, Pill, td, th } from '@/components/ui';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { RegisterUserForm, UserActions } from './user-actions';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'sales';
  displayName: string | null;
  isActive: boolean;
  googleLinked: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  uniqueReceipts: number;
}

export default async function UsersPage() {
  const [me, users, auth] = await Promise.all([
    getMe(),
    apiGet<UserRow[]>('/admin/users'),
    apiGet<{ mode: 'password' | 'google' }>('/auth/mode'),
  ]);
  const passwordMode = auth.mode === 'password';
  const total = users.reduce((n, u) => n + u.uniqueReceipts, 0);

  return (
    <div className="grid gap-4">
      <h1 className="text-page font-semibold">Kelola user</h1>
      <p className="text-ink-muted">
        {passwordMode
          ? 'Sementara login memakai email + password. Hanya user yang terdaftar di sini yang bisa masuk.'
          : 'Hanya email Google yang terdaftar di sini yang bisa masuk. Gmail pribadi juga perlu ada di whitelist (Super Admin).'}
      </p>
      <RegisterUserForm canAssignSuperAdmin={me.role === 'super_admin'} passwordMode={passwordMode} />
      <Grid
        head={
          <tr>
            <th className={th}>Nama</th>
            <th className={th}>{passwordMode ? 'Email' : 'Email Google'}</th>
            <th className={th}>Role</th>
            <th className={th}>Nama sales</th>
            <th className={th}>Status</th>
            <th className={th}>Login terakhir</th>
            <th className={`${th} num`}>Resi unik</th>
            <th className={th}>Aksi</th>
          </tr>
        }
      >
        {users.map((u) => {
          const locked = u.role === 'super_admin' && me.role !== 'super_admin';
          return (
            <tr key={u.id} className={u.isActive ? 'hover:bg-green-50' : 'text-ink-muted'}>
              <td className={td}>{u.name}</td>
              <td className={td}>{u.email}</td>
              <td className={td}>{ROLE_LABEL[u.role]}</td>
              <td className={td}>{u.displayName ?? '–'}</td>
              <td className={td}>
                <Pill tone={u.isActive ? 'good' : 'plain'}>{u.isActive ? 'Aktif' : 'Nonaktif'}</Pill>
                {passwordMode
                  ? !u.hasPassword && <span className="ml-2 text-meta text-bad-ink">belum punya password</span>
                  : !u.googleLinked && <span className="ml-2 text-meta text-ink-muted">belum pernah login</span>}
              </td>
              <td className={td}>{fmtDateTime(u.lastLoginAt)}</td>
              <td className={`${td} num`}>{fmtNum(u.uniqueReceipts)}</td>
              <td className={td}>
                {locked || u.id === me.id ? (
                  <span className="text-meta text-ink-muted">{u.id === me.id ? 'Akun Anda' : 'Hanya dilihat'}</span>
                ) : (
                  <UserActions user={u} canAssignSuperAdmin={me.role === 'super_admin'} passwordMode={passwordMode} />
                )}
              </td>
            </tr>
          );
        })}
        <tr className="bg-canvas font-semibold">
          <td className={td} colSpan={6}>
            Total {users.length} user
          </td>
          <td className={`${td} num`}>{fmtNum(total)}</td>
          <td className={td} />
        </tr>
      </Grid>
    </div>
  );
}
