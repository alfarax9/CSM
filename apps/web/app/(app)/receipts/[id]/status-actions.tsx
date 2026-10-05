'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReceiptStatus } from '@csm/shared';
import { Button, ErrorText } from '@/components/ui';
import { apiSend } from '@/lib/client-api';

export function ReceiptStatusActions({ id, status, staff }: { id: string; status: ReceiptStatus; staff: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');

  async function run(path: string, body?: unknown) {
    const res = await apiSend('POST', `/receipts/${id}/${path}`, body);
    if (!res.ok) return setError(res.error ?? '');
    setError('');
    router.refresh();
  }

  const canDecide = staff && (status === 'ready' || status === 'submitted');
  const canSubmit = !staff && status === 'needs_review';
  if (!canDecide && !canSubmit) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-cell border border-grid bg-surface p-3">
      {canDecide && (
        <>
          <Button onClick={() => run('approve')}>Approve resi</Button>
          <Button
            variant="secondary"
            onClick={() => {
              const reason = window.prompt('Alasan menolak resi ini?');
              if (reason) run('reject', { reason });
            }}
          >
            Tolak resi
          </Button>
        </>
      )}
      {canSubmit && <Button onClick={() => run('submit')}>Kirim ke Admin</Button>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
