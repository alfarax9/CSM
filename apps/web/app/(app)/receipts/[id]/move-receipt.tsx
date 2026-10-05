'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorText, Field, Input, Select } from '@/components/ui';
import { apiSend } from '@/lib/client-api';

/** Pindah resi ke container lain (PRD F4) — bukan scan ulang, Serial No tetap. */
export function MoveReceipt({ id, targets }: { id: string; targets: { id: string; seqNo: number }[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (targets.length === 0) return null;

  return (
    <details className="rounded-cell border border-grid bg-surface p-3">
      <summary className="cursor-pointer font-semibold text-green-800">Pindah ke container lain (Plus 1 / tertinggal)</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const target = targets.find((t) => t.id === f.get('containerId'));
          if (!target || !window.confirm(`Pindahkan resi ini ke Container ${target.seqNo}?`)) return;
          setBusy(true);
          const res = await apiSend('POST', `/receipts/${id}/move`, {
            containerId: target.id,
            note: String(f.get('note') || '').trim() || undefined,
          });
          setBusy(false);
          if (!res.ok) return setError(res.error ?? '');
          setError('');
          router.refresh();
        }}
      >
        <Field label="Container tujuan">
          <Select name="containerId" required defaultValue="">
            <option value="" disabled>
              Pilih
            </option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                Container {t.seqNo}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Catatan Ket. (kosong = Plus 1 (dari …))">
          <Input name="note" placeholder="Plus 1 (64627)" maxLength={200} />
        </Field>
        <Button type="submit" variant="secondary" disabled={busy}>
          Pindahkan resi
        </Button>
        <div className="sm:col-span-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </details>
  );
}
