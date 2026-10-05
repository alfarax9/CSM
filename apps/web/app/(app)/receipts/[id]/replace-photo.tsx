'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button, ErrorText } from '@/components/ui';
import { processFile, uploadJpeg } from '@/lib/photo';

/** Ganti foto resi (PRD F7): di HP langsung membuka kamera, di laptop memilih file. Versi lama tetap disimpan. */
export function ReplacePhoto({ id, hasPhoto }: { id: string; hasPhoto: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Mengunggah…' : hasPhoto ? 'Ganti foto' : 'Tambah foto'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError('');
          try {
            const photo = await processFile(file);
            setWarning(photo.quality.problems.join(' '));
            const res = await uploadJpeg(`/receipts/${id}/image`, photo);
            URL.revokeObjectURL(photo.url);
            if (!res.ok) setError(res.error);
            else router.refresh();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {warning && <p className="text-meta text-neutral-ink">{warning}</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
