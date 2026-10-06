'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { AUTO_LIMITS, analyzeFrame } from '@/lib/auto-capture';
import { type ProcessedPhoto, processFile, processPhoto } from '@/lib/photo';

type AutoState = 'off' | 'searching' | 'holding' | 'captured';

function readPref(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* localStorage tidak tersedia */
  }
}

/**
 * Viewfinder kamera (PRD F1, §8): kamera belakang di HP, webcam di laptop, bingkai A5 portrait,
 * ambil otomatis saat kertas stabil 0,6 detik, pesan satu baris di atas tombol, dan upload foto dari galeri/file.
 */
export function PhotoCapture({ onPhoto, disabled }: { onPhoto: (p: ProcessedPhoto) => void; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Gambar kamera tidak di-mirror (tulisan terbaca normal). Untuk kamera yang mengirim gambar cermin, user bisa membalik.
  const [flip, setFlip] = useState(false);
  const [auto, setAuto] = useState(true);
  const [autoState, setAutoState] = useState<AutoState>('off');
  const onPhotoRef = useRef(onPhoto);
  onPhotoRef.current = onPhoto;

  useEffect(() => {
    setFlip(readPref('csm.camera.flip', false));
    setAuto(readPref('csm.camera.auto', true));
  }, []);

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
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
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
        setMessage(
          'Izin kamera ditolak atau kamera tidak ditemukan. Pakai Upload foto, atau izinkan kamera di pengaturan browser.',
        );
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
      onPhotoRef.current(await work());
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Ambil otomatis: analisis frame tiap 200 ms; kertas siap & diam ≥ 0,6 dtk → foto. Setelah itu menunggu
  // kertas diganti (gambar berubah / kertas diangkat) supaya kertas yang sama tidak terfoto berulang.
  useEffect(() => {
    if (camera !== 'on' || !auto || disabled) {
      setAutoState('off');
      return;
    }
    const canvas = document.createElement('canvas');
    const prev: { gray: Float32Array | null } = { gray: null };
    let readySince = 0;
    let armed = true;
    let capturing = false;
    setAutoState('searching');
    const timer = setInterval(async () => {
      const v = video.current;
      if (!v || capturing) return;
      const stats = analyzeFrame(v, canvas, prev);
      if (!stats) return;
      if (!armed) {
        // Siap lagi setelah kertas diangkat (kontras hilang) atau gambar berubah banyak.
        if (stats.contrast < AUTO_LIMITS.contrastMin / 2 || stats.still > 25) {
          armed = true;
          setAutoState('searching');
        }
        return;
      }
      if (!stats.ready) {
        readySince = 0;
        setAutoState('searching');
        return;
      }
      readySince ||= Date.now();
      setAutoState('holding');
      if (Date.now() - readySince >= AUTO_LIMITS.holdMs) {
        capturing = true;
        armed = false;
        readySince = 0;
        setAutoState('captured');
        try {
          onPhotoRef.current(await processPhoto(v, flip));
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          capturing = false;
        }
      }
    }, 200);
    return () => clearInterval(timer);
  }, [camera, auto, disabled, flip]);

  const hint =
    message ||
    (camera !== 'on'
      ? ''
      : !auto
        ? 'Posisikan kertas resi di dalam bingkai hijau, lalu ambil foto.'
        : {
            off: 'Posisikan kertas resi di dalam bingkai hijau.',
            searching: 'Arahkan kertas resi ke dalam bingkai hijau — foto diambil otomatis.',
            holding: 'Tahan… jangan bergerak.',
            captured: 'Foto diambil. Ganti dengan kertas berikutnya.',
          }[autoState]);

  const frameColor =
    autoState === 'holding' ? 'border-neutral-ink' : autoState === 'captured' ? 'border-white' : 'border-green-400';

  return (
    <div className="grid gap-3">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-cell bg-ink">
        <video
          ref={video}
          playsInline
          muted
          className={`h-full w-full object-cover ${camera === 'on' ? '' : 'hidden'} ${flip ? '-scale-x-100' : ''}`}
        />
        {camera === 'on' && (
          // Bingkai A5 portrait (148 × 210 mm) sebagai panduan posisi kertas.
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <div
              className={`aspect-[148/210] h-[88%] rounded-cell border-2 ${frameColor} shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]`}
            />
          </div>
        )}
        {camera !== 'on' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-meta text-white">
            {camera === 'starting' ? 'Menyalakan kamera…' : 'Kamera tidak aktif'}
          </div>
        )}
      </div>

      <p className="min-h-5 text-center text-meta text-ink-muted" role="status" aria-live="polite">
        {hint}
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {camera === 'on' && (
          <Button
            className="h-9 px-5"
            disabled={disabled || busy}
            onClick={() => handle(() => processPhoto(video.current!, flip))}
          >
            {busy ? 'Memproses…' : 'Ambil foto'}
          </Button>
        )}
        {camera === 'on' && (
          <Button
            variant="secondary"
            className="h-9"
            aria-pressed={auto}
            onClick={() => {
              writePref('csm.camera.auto', !auto);
              setAuto(!auto);
            }}
          >
            {auto ? 'Otomatis: aktif' : 'Otomatis: mati'}
          </Button>
        )}
        {camera === 'on' && (
          <Button
            variant="secondary"
            className="h-9"
            aria-pressed={flip}
            onClick={() => {
              writePref('csm.camera.flip', !flip);
              setFlip(!flip);
            }}
          >
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
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            // Beberapa foto sekaligus masuk antrean satu per satu.
            for (const file of files) await handle(() => processFile(file));
          }}
        />
      </div>
    </div>
  );
}
