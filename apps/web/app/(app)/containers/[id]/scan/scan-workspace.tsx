'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PhotoCapture } from '@/components/photo-capture';
import { PhotoViewer } from '@/components/photo-viewer';
import { ReceiptForm } from '@/components/receipt-form';
import { Button, ErrorText } from '@/components/ui';
import { type ProcessedPhoto, uploadJpeg } from '@/lib/photo';

type Step =
  | { kind: 'camera' }
  | { kind: 'check'; photo: ProcessedPhoto }
  | { kind: 'form'; photo: ProcessedPhoto; token: string };

interface Duplicate {
  receiptId: string;
  serialNo: number | null;
  containerSeqNo: number;
}

/** Alur scan beruntun: foto → cek kualitas → upload → isi form (split foto | form) → resi berikutnya. */
export function ScanWorkspace({ containerId, staff, sales }: { containerId: string; staff: boolean; sales: { id: string; name: string }[] }) {
  const [step, setStep] = useState<Step>({ kind: 'camera' });
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const [blocked, setBlocked] = useState(0);

  function reset() {
    if (step.kind !== 'camera') URL.revokeObjectURL(step.photo.url);
    setStep({ kind: 'camera' });
    setError('');
  }

  async function upload(photo: ProcessedPhoto) {
    setBusy(true);
    setDuplicate(null);
    const res = await uploadJpeg<{ token: string }>(`/containers/${containerId}/scans`, photo);
    setBusy(false);
    if (res.ok) return setStep({ kind: 'form', photo, token: res.data.token });
    if (res.code === 'PHOTO_DUPLICATE') {
      setBlocked((n) => n + 1);
      setDuplicate(res.details as Duplicate);
      // Getar + suara berbeda dari sukses (PRD F7), jika didukung perangkat.
      navigator.vibrate?.([120, 60, 120]);
    }
    setError(res.error);
  }

  return (
    <div className="grid gap-4">
      <p className="text-meta text-ink-muted" role="status">
        {saved} resi tersimpan sesi ini · {blocked} duplikat diblokir
      </p>

      {step.kind === 'camera' && (
        <PhotoCapture
          onPhoto={(photo) => {
            setError('');
            setDuplicate(null);
            // Foto bagus langsung diunggah; foto bermasalah ditinjau dulu.
            if (photo.quality.problems.length === 0) upload(photo);
            else setStep({ kind: 'check', photo });
          }}
          disabled={busy}
        />
      )}

      {step.kind === 'check' && (
        <div className="grid gap-3 lg:grid-cols-[45fr_55fr]">
          <PhotoViewer src={step.photo.url} alt="Foto resi" />
          <div className="grid content-start gap-3">
            <div className="rounded-cell bg-neutral px-3 py-2 text-neutral-ink">
              {step.photo.quality.problems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={reset}>Ulangi foto</Button>
              <Button variant="secondary" disabled={busy} onClick={() => upload(step.photo)}>
                Tetap pakai foto ini
              </Button>
            </div>
          </div>
        </div>
      )}

      {duplicate && (
        <div role="alert" className="rounded-cell bg-bad px-3 py-2 text-bad-ink">
          <p className="font-semibold">{error}</p>
          <p className="mt-1 text-meta">
            Foto yang sama persis sudah pernah di-scan.{' '}
            {staff && (
              <Link href={`/receipts/${duplicate.receiptId}`} className="underline">
                Buka resi lama
              </Link>
            )}
          </p>
        </div>
      )}
      {!duplicate && <ErrorText>{error}</ErrorText>}

      {step.kind === 'form' && (
        <div className="grid items-start gap-4 lg:grid-cols-[45fr_55fr]">
          <div className="grid gap-2 lg:sticky lg:top-0">
            <PhotoViewer src={step.photo.url} alt="Foto resi yang baru di-scan" />
            <Button variant="secondary" onClick={reset}>
              Ulangi foto
            </Button>
          </div>
          <ReceiptForm
            key={step.token}
            containerId={containerId}
            staff={staff}
            sales={sales}
            imageToken={step.token}
            onCreated={() => {
              setSaved((n) => n + 1);
              reset();
            }}
          />
        </div>
      )}
    </div>
  );
}
