'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { type ProcessedPhoto, processFile, processPhoto } from '@/lib/photo';

/**
 * Viewfinder kamera (PRD F1, §8): kamera belakang di HP, webcam di laptop, bingkai A5 portrait,
 * pesan kualitas satu baris di atas tombol. Selalu ada pilihan upload foto dari galeri/file.
 */
export function PhotoCapture({ onPhoto, disabled }: { onPhoto: (p: ProcessedPhoto) => void; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Gambar kamera tidak di-mirror (tulisan terbaca normal). Untuk kamera yang mengirim gambar cermin, user bisa membalik.
  const [flip, setFlip] = useState(false);

  useEffect(() => {
    try {
      setFlip(localStorage.getItem('csm.camera.flip') === '1');
    } catch {
      /* localStorage tidak tersedia: pakai bawaan */
    }
  }, []);

  function toggleFlip() {
    setFlip((f) => {
      try {
        localStorage.setItem('csm.camera.flip', f ? '0' : '1');
      } catch {
        /* abaikan */
      }
      return !f;
    });
  }

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('off');
        setMessage('Kamera tidak tersedia di browser ini (butuh HTTPS atau localhost). Pakai Upload foto.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
        }
        setCamera('on');
      } catch {
        setCamera('off');
        setMessage('Izin kamera ditolak atau kamera tidak ditemukan. Pakai Upload foto, atau izinkan kamera di pengaturan browser.');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function handle(work: () => Promise<ProcessedPhoto>) {
    setBusy(true);
    try {
      onPhoto(await work());
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-cell bg-ink">
        <video ref={video} playsInline muted className={`h-full w-full object-cover ${camera === 'on' ? '' : 'hidden'} ${flip ? '-scale-x-100' : ''}`} />
        {camera === 'on' && (
          // Bingkai A5 portrait (148 × 210 mm) sebagai panduan posisi kertas.
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="aspect-[148/210] h-[88%] rounded-cell border-2 border-green-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {camera !== 'on' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-meta text-white">
            {camera === 'starting' ? 'Menyalakan kamera…' : 'Kamera tidak aktif'}
          </div>
        )}
      </div>

      <p className="min-h-5 text-center text-meta text-ink-muted" role="status">
        {message || (camera === 'on' ? 'Posisikan kertas resi di dalam bingkai hijau, lalu ambil foto.' : '')}
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {camera === 'on' && (
          <Button className="h-9 px-5" disabled={disabled || busy} onClick={() => handle(() => processPhoto(video.current!, flip))}>
            {busy ? 'Memproses…' : 'Ambil foto'}
          </Button>
        )}
        {camera === 'on' && (
          <Button variant="secondary" className="h-9" onClick={toggleFlip} aria-pressed={flip}>
            {flip ? 'Gambar dibalik' : 'Balik gambar'}
          </Button>
        )}
        <Button variant="secondary" className="h-9" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
          Upload foto
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handle(() => processFile(file));
          }}
        />
      </div>
    </div>
  );
}
