'use client';

export interface SendResult {
  ok: boolean;
  error?: string;
}

function cookie(name: string): string {
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1] ?? '';
}

/** Aksi dari browser ke API; pesan error diambil dari format error seragam API. */
export async function apiSend(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<SendResult> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-csm-csrf': cookie('csm_csrf') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  if (res.status === 401) window.location.href = '/login';
  const data = (await res.json().catch(() => null)) as { error?: { message?: string; details?: { message?: string }[] } } | null;
  const detail = data?.error?.details?.[0]?.message;
  return { ok: false, error: detail ?? data?.error?.message ?? `Gagal (HTTP ${res.status}).` };
}
