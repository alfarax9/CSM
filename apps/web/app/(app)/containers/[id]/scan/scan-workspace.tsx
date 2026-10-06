'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PhotoCapture } from '@/components/photo-capture';
import { PhotoViewer } from '@/components/photo-viewer';
import { ReceiptForm, type SuggestedField } from '@/components/receipt-form';
import { Button, ErrorText } from '@/components/ui';
import { apiSend } from '@/lib/client-api';
import { feedbackDuplicate, feedbackSuccess } from '@/lib/feedback';
import { fmtDateTime } from '@/lib/format';
import { type ProcessedPhoto, uploadJpeg } from '@/lib/photo';

interface Duplicate {
  receiptId: string | null;
  /** Foto identik masih di antrean (belum jadi resi). */
  pending?: boolean;
  serialNo: number | null;
  containerSeqNo: number;
  sales?: string;
  createdBy?: string | null;
  createdAt?: string;
  deleted?: boolean;
}

type Status = 'uploading' | 'reading' | 'ready' | 'duplicate' | 'saved' | 'skipped';

interface Item {
  id: string;
  photo: ProcessedPhoto;
  /** sha256 JPEG, untuk mendeteksi foto yang sama dipilih dua kali dalam sesi ini. */
  hash?: string;
  status: Status;
  token?: string;
  suggestions?: Record<string, SuggestedField>;
  duplicate?: Duplicate;
  /** Duplikat karena foto identik (lapis 1): tidak ada foto sementara, tidak bisa dipakai. */
  photoDuplicate?: boolean;
  note?: string;
  error?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  uploading: 'Mengunggah…',
  reading: 'Membaca…',
  ready: 'Siap dicek',
  duplicate: 'Duplikat',
  saved: 'Tersimpan',
  skipped: 'Dilewati',
};

const STATUS_TONE: Record<Status, string> = {
  uploading: 'text-ink-muted',
  reading: 'text-ink-muted',
  ready: 'bg-neutral text-neutral-ink',
  duplicate: 'bg-bad text-bad-ink',
  saved: 'bg-good text-good-ink',
  skipped: 'text-ink-muted',
};

/**
 * Mode batch (PRD F1): kamera tetap terbuka, setiap foto masuk antrean dan dibaca otomatis di latar belakang,
 * lalu dicek di panel kanan (foto | form). Duplikat diblokir dengan panel merah + bunyi berbeda (PRD F7).
 */
export function ScanWorkspace({
  containerId,
  staff,
  sales,
}: {
  containerId: string;
  staff: boolean;
  sales: { id: string; name: string }[];
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [check, setCheck] = useState<ProcessedPhoto | null>(null);
  const [blocked, setBlocked] = useState(0);
  const [busyAction, setBusyAction] = useState(false);
  const [actionError, setActionError] = useState('');
  const reviewRef = useRef<HTMLDivElement>(null);
  const hashesRef = useRef(new Map<string, string>());

  const update = useCallback((id: string, patch: Partial<Item>) => {
    setItems((list) =>
      list.map((it) => {
        if (it.id !== id) return it;
        // Foto yang dilewati/dibuang boleh di-scan lagi.
        if (patch.status === 'skipped' && it.hash && hashesRef.current.get(it.hash) === id) hashesRef.current.delete(it.hash);
        return { ...it, ...patch };
      }),
    );
  }, []);

  /** Unggah → baca otomatis → siap dicek / duplikat. Berjalan di latar belakang; kamera tetap bisa dipakai. */
  const enqueue = useCallback(
    async (photo: ProcessedPhoto) => {
      const id = crypto.randomUUID();
      const digest = await crypto.subtle.digest('SHA-256', await photo.blob.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      // Foto yang sama persis sudah ada di antrean sesi ini (mis. file yang sama dipilih dua kali).
      if (hashesRef.current.has(hash)) {
        feedbackDuplicate();
        setBlocked((n) => n + 1);
        setItems((list) => [
          {
            id,
            photo,
            hash,
            status: 'duplicate',
            photoDuplicate: true,
            duplicate: { receiptId: null, serialNo: null, containerSeqNo: 0, pending: true },
            error: 'Foto yang sama persis sudah ada di antrean scan sesi ini.',
          },
          ...list,
        ]);
        return;
      }
      hashesRef.current.set(hash, id);
      setItems((list) => [{ id, photo, hash, status: 'uploading' }, ...list]);
      const up = await uploadJpeg<{ token: string }>(`/containers/${containerId}/scans`, photo);
      if (!up.ok) {
        if (up.code === 'PHOTO_DUPLICATE') {
          feedbackDuplicate();
          setBlocked((n) => n + 1);
          return update(id, {
            status: 'duplicate',
            photoDuplicate: true,
            duplicate: up.details as Duplicate,
            error: up.error,
          });
        }
        return update(id, { status: 'skipped', error: up.error });
      }
      update(id, { status: 'reading', token: up.data.token });
      const ex = await apiSend<{
        model: string;
        seconds: number;
        fields: Record<string, SuggestedField>;
        duplicate: Duplicate | null;
      }>('POST', `/containers/${containerId}/scans/${up.data.token}/extract`);
      if (ex.ok && ex.data?.duplicate) {
        feedbackDuplicate();
        setBlocked((n) => n + 1);
        return update(id, {
          status: 'duplicate',
          duplicate: ex.data.duplicate,
          suggestions: ex.data.fields,
        });
      }
      feedbackSuccess();
      update(
        id,
        ex.ok && ex.data
          ? {
              status: 'ready',
              suggestions: ex.data.fields,
              note: `Dibaca ${ex.data.model} dalam ${ex.data.seconds} detik.`,
            }
          : { status: 'ready', note: ex.error },
      );
    },
    [containerId, update],
  );

  // Pilih otomatis resi berikutnya yang perlu ditindaklanjuti jika belum ada yang dipilih.
  useEffect(() => {
    const current = items.find((i) => i.id === selected);
    if (current && (current.status === 'ready' || current.status === 'duplicate')) return;
    const next = [...items].reverse().find((i) => i.status === 'ready' || i.status === 'duplicate');
    setSelected(next?.id ?? null);
  }, [items, selected]);

  useEffect(() => {
    setActionError('');
  }, [selected]);

  const item = items.find((i) => i.id === selected);
  const saved = items.filter((i) => i.status === 'saved').length;
  const processing = items.filter((i) => i.status === 'uploading' || i.status === 'reading').length;
  const waiting = items.filter((i) => i.status === 'ready').length;

  /** "Lewati" / "Buang foto": hapus foto sementara di server (PRD F7). */
  const discard = (token: string) => apiSend('DELETE', `/containers/${containerId}/scans/${token}`);

  async function action(fn: () => Promise<{ ok: boolean; error?: string }>, onOk: () => void) {
    setBusyAction(true);
    const res = await fn();
    setBusyAction(false);
    if (!res.ok) return setActionError(res.error ?? 'Gagal.');
    onOk();
  }

  return (
    <div className="grid gap-4">
      <p className="text-meta" role="status" aria-live="polite">
        <span className="font-semibold">{saved} resi tersimpan</span> · {processing} sedang diproses · {waiting} menunggu dicek ·{' '}
        <span className={blocked ? 'text-bad-ink' : ''}>{blocked} duplikat diblokir</span>
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        {/* Kiri: kamera + antrean */}
        <div className="grid gap-3">
          {check ? (
            <div className="grid gap-3">
              <PhotoViewer src={check.url} alt="Foto resi" />
              <div className="rounded-cell bg-neutral px-3 py-2 text-neutral-ink">
                {check.quality.problems.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    URL.revokeObjectURL(check.url);
                    setCheck(null);
                  }}
                >
                  Ulangi foto
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    enqueue(check);
                    setCheck(null);
                  }}
                >
                  Tetap pakai foto ini
                </Button>
              </div>
            </div>
          ) : (
            <PhotoCapture onPhoto={(p) => (p.quality.problems.length ? setCheck(p) : enqueue(p))} />
          )}

          {items.length > 0 && (
            <ol aria-label="Antrean scan" className="grid gap-1">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(it.id);
                      reviewRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }}
                    className={`flex w-full items-center gap-3 rounded-cell border p-1.5 text-left ${
                      it.id === selected ? 'border-green-600 bg-green-50' : 'border-grid bg-surface hover:bg-green-50'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau lokal (blob) */}
                    <img src={it.photo.url} alt="" className="h-12 w-9 rounded-cell object-cover" />
                    <span className="grid flex-1 text-meta">
                      <span className="font-semibold">
                        {it.suggestions?.serialNo ? `Serial ${String(it.suggestions.serialNo.value)}` : 'Serial belum terbaca'}
                      </span>
                      {it.error && it.status !== 'duplicate' && <span className="text-bad-ink">{it.error}</span>}
                    </span>
                    <span className={`rounded-cell px-2 py-0.5 text-meta ${STATUS_TONE[it.status]}`}>
                      {STATUS_LABEL[it.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Kanan: cek resi terpilih */}
        <div ref={reviewRef} className="grid min-w-0 gap-3">
          {!item && (
            <p className="rounded-cell border border-grid bg-surface p-4 text-ink-muted">
              {items.length === 0
                ? 'Foto resi pertama. Hasil baca otomatis muncul di sini untuk dicek.'
                : processing > 0
                  ? 'Membaca resi di latar belakang… silakan foto kertas berikutnya.'
                  : 'Semua resi di antrean sudah ditindaklanjuti.'}
            </p>
          )}

          {item?.status === 'duplicate' && item.duplicate && (
            <div className="grid gap-3 lg:grid-cols-[45fr_55fr]">
              <PhotoViewer src={item.photo.url} alt="Foto resi duplikat" />
              <div role="alert" className="grid content-start gap-3 rounded-cell bg-bad p-4 text-bad-ink">
                <p className="font-semibold">
                  {item.photoDuplicate
                    ? item.error
                    : `Serial No ${item.duplicate.serialNo} sudah di-scan · Container ${item.duplicate.containerSeqNo}${
                        item.duplicate.sales ? ` · ${item.duplicate.sales}` : ''
                      }${item.duplicate.createdBy ? ` · oleh ${item.duplicate.createdBy}` : ''}${
                        item.duplicate.createdAt ? `, ${fmtDateTime(item.duplicate.createdAt)}` : ''
                      }`}
                </p>
                <p className="text-meta">
                  {item.photoDuplicate
                    ? 'Foto yang sama persis tidak boleh dipakai dua kali. Jika ini resi yang berbeda, foto ulang kertasnya.'
                    : 'Satu Serial No hanya boleh ada satu kali. Resi yang pindah container dipindah lewat fitur Pindah, bukan di-scan ulang.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {item.duplicate.receiptId && !item.duplicate.deleted && (
                    <Link
                      href={`/receipts/${item.duplicate.receiptId}`}
                      target="_blank"
                      className="flex h-8 items-center rounded-button border border-grid bg-surface px-3 font-semibold text-ink hover:bg-green-50"
                    >
                      Buka resi lama
                    </Link>
                  )}
                  {!item.photoDuplicate && item.token && !item.duplicate.deleted && (
                    <Button
                      variant="secondary"
                      disabled={busyAction}
                      onClick={() =>
                        action(
                          () => apiSend('POST', `/receipts/${item.duplicate!.receiptId}/image-from-scan`, { token: item.token }),
                          () => {
                            feedbackSuccess();
                            update(item.id, {
                              status: 'saved',
                              note: 'Foto resi lama diganti dengan foto ini.',
                            });
                          },
                        )
                      }
                    >
                      Ganti foto resi lama
                    </Button>
                  )}
                  {!item.photoDuplicate && item.token && (
                    <Button
                      variant="secondary"
                      disabled={busyAction}
                      onClick={() =>
                        update(item.id, {
                          status: 'ready',
                          note: 'Ketik Serial No yang benar dari kertas.',
                        })
                      }
                    >
                      Serial salah baca
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={busyAction}
                    onClick={() =>
                      action(
                        async () => (item.token ? discard(item.token) : { ok: true }),
                        () => update(item.id, { status: 'skipped' }),
                      )
                    }
                  >
                    Lewati
                  </Button>
                </div>
                <ErrorText>{actionError}</ErrorText>
              </div>
            </div>
          )}

          {item?.status === 'ready' && item.token && (
            <div className="grid items-start gap-4 xl:grid-cols-[45fr_55fr]">
              <div className="grid gap-2 xl:sticky xl:top-0">
                <PhotoViewer src={item.photo.url} alt="Foto resi yang di-scan" />
                <Button
                  variant="secondary"
                  disabled={busyAction}
                  onClick={() =>
                    action(
                      () => discard(item.token!),
                      () => update(item.id, { status: 'skipped' }),
                    )
                  }
                >
                  Buang foto ini
                </Button>
              </div>
              <div className="grid gap-2">
                {item.note && <p className="text-meta text-ink-muted">{item.note}</p>}
                <ReceiptForm
                  key={item.token}
                  containerId={containerId}
                  staff={staff}
                  sales={sales}
                  imageToken={item.token}
                  suggestions={item.suggestions}
                  onCreated={() => {
                    feedbackSuccess();
                    update(item.id, { status: 'saved' });
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
