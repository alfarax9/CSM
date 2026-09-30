'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ContainerStatus } from '@csm/shared';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { apiSend } from '@/lib/client-api';

/** Tombol menyebut hasilnya (PRD §8 aturan 7). */
const NEXT: Partial<Record<ContainerStatus, { to: ContainerStatus; label: string }>> = {
  draft: { to: 'loading', label: 'Mulai loading' },
  loading: { to: 'locked', label: 'Lock container' },
  locked: { to: 'shipped', label: 'Tandai shipped' },
  shipped: { to: 'unloading', label: 'Mulai pecah pos' },
  unloading: { to: 'closed', label: 'Tutup container' },
};

export function CreateContainerForm({ nextSeq }: { nextSeq: number }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-3 rounded-cell border border-grid bg-surface p-4 sm:grid-cols-[120px_1fr_160px_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        const res = await apiSend('POST', '/containers', {
          seqNo: Number(f.get('seqNo')),
          boxNo: String(f.get('boxNo') || '') || undefined,
          loadingDate: String(f.get('loadingDate') || '') || undefined,
        });
        setBusy(false);
        if (!res.ok) return setError(res.error ?? '');
        setError('');
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }}
    >
      <Field label="Nomor urut">
        <Input name="seqNo" type="number" min={1} required defaultValue={nextSeq} className="num" />
      </Field>
      <Field label="Nomor box (opsional)">
        <Input name="boxNo" placeholder="TXGU 7181980" />
      </Field>
      <Field label="Tanggal loading">
        <Input name="loadingDate" type="date" />
      </Field>
      <Button type="submit" disabled={busy}>
        Buat container
      </Button>
      <div className="sm:col-span-4">
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}

export function StatusActions({ id, seqNo, status, isSuperAdmin }: { id: string; seqNo: number; status: ContainerStatus; isSuperAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');

  async function move(to: ContainerStatus, label: string) {
    const warn = to === 'closed' ? '\nFoto dan data pribadi resi akan dihapus 30 hari setelah ditutup.' : '';
    if (!window.confirm(`${label} untuk Container ${seqNo}?${warn}`)) return;
    const res = await apiSend('PATCH', `/containers/${id}`, { status: to });
    if (!res.ok) return setError(res.error ?? '');
    setError('');
    router.refresh();
  }

  const next = NEXT[status];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {next && (
        <Button variant="secondary" onClick={() => move(next.to, next.label)}>
          {next.label}
        </Button>
      )}
      {status === 'locked' && isSuperAdmin && (
        <Button variant="secondary" onClick={() => move('loading', 'Unlock container')}>
          Unlock
        </Button>
      )}
      {error && <span className="text-meta text-bad-ink">{error}</span>}
    </div>
  );
}
