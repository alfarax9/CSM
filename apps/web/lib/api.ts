import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/** Panggil API dari server component dengan meneruskan cookie sesi user. */
export async function apiGet<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API}/api/v1${path}`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/containers');
  if (!res.ok) throw new Error(`API ${path} gagal: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'sales';
  displayName: string | null;
  avatarUrl: string | null;
}

export const getMe = () => apiGet<Me>('/me');
