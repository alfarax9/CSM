'use client';

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: unknown;
}

function cookie(name: string): string {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1] ?? '';
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-csm-csrf': cookie('csm_csrf') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) window.location.href = '/login';
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null;
  if (res.ok) return { ok: true, data: json as T };
  const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  // Error validasi Zod: tampilkan pesan field pertama.
  const zodMessage = Array.isArray(err?.details) ? (err.details[0] as { message?: string } | undefined)?.message : undefined;
  return {
    ok: false,
    code: err?.code,
    details: err?.details,
    error: zodMessage ?? err?.message ?? `Gagal (HTTP ${res.status}).`,
  };
}

/** Aksi dari browser ke API; pesan error diambil dari format error seragam API. */
export function apiSend<T = unknown>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  return call<T>(method, path, body);
}

export function apiFetch<T>(path: string) {
  return call<T>('GET', path);
}
