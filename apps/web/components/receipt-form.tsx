'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PACKAGE_TYPES, type PackageType } from '@csm/shared';
import { Button, ErrorText, Field, Input, Select } from '@/components/ui';
import { apiFetch, apiSend } from '@/lib/client-api';
import { fmtDateTime } from '@/lib/format';
import { PACKAGE_LABEL, type ReceiptDetail, type SerialDuplicate } from '@/lib/receipts';

interface Wilayah {
  code: string;
  name: string;
  shortName: string;
  province: string | null;
}

interface Props {
  containerId: string;
  staff: boolean;
  sales: { id: string; name: string }[];
  initial?: ReceiptDetail;
  readOnly?: boolean;
  /** Token foto hasil scan; resi tersimpan dengan foto ini (sumber `camera`). */
  imageToken?: string;
  /** Mode scan beruntun: dipanggil setelah resi baru tersimpan, menggantikan navigasi ke sheet. */
  onCreated?: (r: ReceiptDetail) => void;
  /** Saran hasil baca foto (VLM); mengisi form dan diberi warna sampai dicek manusia. */
  suggestions?: Record<string, SuggestedField>;
}

export interface SuggestedField {
  value: unknown;
  level: 'neutral' | 'bad';
  reason: string | null;
}

/** Panel merah Serial No ganda (PRD F7): lokasi resi lama. */
function DuplicatePanel({ dup, staff }: { dup: SerialDuplicate; staff: boolean }) {
  return (
    <div role="alert" className="rounded-cell border border-bad-ink/30 bg-bad px-3 py-2 text-bad-ink">
      <p className="font-semibold">
        Serial No {dup.serialNo} sudah di-scan · Container {dup.containerSeqNo} · {dup.sales}
        {dup.createdBy ? ` · oleh ${dup.createdBy}` : ''}, {fmtDateTime(dup.createdAt)}
        {dup.deleted ? ' (resi sudah dihapus)' : ''}
      </p>
      <p className="mt-1 text-meta">
        Satu Serial No hanya boleh ada satu kali. Cek angka di kertas; jika resi pindah container, pakai fitur Pindah (bukan input
        ulang).{' '}
        {staff && !dup.deleted && (
          <Link href={`/receipts/${dup.receiptId}`} className="underline">
            Buka resi lama
          </Link>
        )}
      </p>
    </div>
  );
}

/** Kolom Tujuan: autocomplete kab/kota dari gazetteer (GET /wilayah/search). */
function DestinationInput({ value, onChange, disabled }: { value: { code: string; label: string } | null; onChange: (v: { code: string; label: string } | null) => void; disabled?: boolean }) {
  const [q, setQ] = useState(value?.label ?? '');
  const [items, setItems] = useState<Wilayah[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || q.trim().length < 2) return setItems([]);
    const t = setTimeout(async () => {
      const res = await apiFetch<Wilayah[]>(`/wilayah/search?q=${encodeURIComponent(q.trim())}`);
      setItems(res.data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  return (
    <div className="relative">
      <Input
        value={q}
        disabled={disabled}
        placeholder="Ketik kab/kota, mis. Pamekasan"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-autocomplete="list"
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute z-10 mt-1 w-full rounded-cell border border-grid bg-surface shadow-md">
          {items.map((w) => (
            <li key={w.code}>
              <button
                type="button"
                className="flex w-full justify-between px-2 py-1.5 text-left hover:bg-green-50"
                onMouseDown={() => {
                  onChange({ code: w.code, label: w.shortName });
                  setQ(w.shortName);
                  setOpen(false);
                }}
              >
                <span>{w.name}</span>
                <span className="text-meta text-ink-muted">{w.province}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReceiptForm({ containerId, staff, sales, initial, readOnly = false, imageToken, onCreated, suggestions }: Props) {
  const router = useRouter();
  const [serial, setSerial] = useState(initial ? String(initial.serialNo) : suggestions?.serialNo ? String(suggestions.serialNo.value) : '');
  const [dup, setDup] = useState<SerialDuplicate | null>(null);
  const [dest, setDest] = useState(initial?.wilayahCode ? { code: initial.wilayahCode, label: initial.destCity ?? '' } : null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>(initial?.warnings ?? []);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Cek Serial No ganda saat diketik (PRD F7 lapis 3).
  useEffect(() => {
    if (!/^\d{4,5}$/.test(serial) || (initial && Number(serial) === initial.serialNo)) return setDup(null);
    const t = setTimeout(async () => {
      const res = await apiFetch<{ available: boolean; duplicate: SerialDuplicate | null }>(
        `/receipts/check-serial?no=${serial}${initial ? `&except=${initial.id}` : ''}`,
      );
      setDup(res.data?.duplicate ?? null);
    }, 300);
    return () => clearTimeout(t);
  }, [serial, initial]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    const num = (k: string) => (text(k) === '' ? null : Number(text(k)));
    const body: Record<string, unknown> = {
      serialNo: Number(serial),
      receiptDate: text('receiptDate') || null,
      senderName: text('senderName'),
      passportNo: text('passportNo'),
      senderPhone: text('senderPhone'),
      recipientName: text('recipientName'),
      recipientPhone: text('recipientPhone'),
      address: text('address'),
      wilayahCode: dest?.code ?? null,
      packages: Object.fromEntries(PACKAGE_TYPES.map((p) => [p, Number(text(`pkg_${p}`) || 0)])),
      koliTotal: num('koliTotal'),
      weightKg: num('weightKg'),
      insurance: num('insurance'),
      packing: num('packing'),
      vat: num('vat'),
      grandTotal: num('grandTotal'),
      cekNote: text('cekNote'),
    };
    if (staff) body.salesId = text('salesId') || undefined;
    if (imageToken) body.imageToken = imageToken;

    setBusy(true);
    const res = initial
      ? await apiSend<ReceiptDetail>('PATCH', `/receipts/${initial.id}`, body)
      : await apiSend<ReceiptDetail>('POST', `/containers/${containerId}/receipts`, body);
    setBusy(false);
    if (!res.ok) {
      if (res.code === 'SERIAL_DUPLICATE') setDup(res.details as SerialDuplicate);
      return setError(res.error ?? '');
    }
    setError('');
    setWarnings(res.data?.warnings ?? []);
    if (initial) return router.refresh();
    if (onCreated && res.data) return onCreated(res.data);
    // Resi baru: kembali ke sheet container, atau kosongkan form untuk resi berikutnya.
    if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'next') {
      formRef.current?.reset();
      setSerial('');
      setDest(null);
      router.refresh();
    } else {
      router.push(`/containers/${containerId}`);
      router.refresh();
    }
  }

  const v = (k: keyof ReceiptDetail) => {
    const val = initial ? initial[k] : suggestions?.[k]?.value;
    return val === null || val === undefined ? '' : String(val);
  };
  /** Warna field hasil mesin (PRD §8): kuning = perlu dicek, merah = gagal validasi. Hilang setelah diubah. */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const hl = (k: string) => {
    const s = !initial && !touched.has(k) ? suggestions?.[k] : undefined;
    return s ? (s.level === 'bad' ? 'bg-bad text-bad-ink' : 'bg-neutral') : '';
  };
  const reasonOf = (k: string) => (!initial && !touched.has(k) ? suggestions?.[k]?.reason : null);
  const touch = (k: string) => () => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)));
  const suggestedPackages = (suggestions?.packages?.value ?? {}) as Partial<Record<PackageType, number>>;

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-4">
      {suggestions && !initial && Object.keys(suggestions).length > 0 && (
        <div className="grid gap-1 rounded-cell border border-grid bg-surface p-3 text-meta">
          <p>
            <span className="font-semibold">Terisi otomatis dari foto.</span> Cocokkan setiap field berwarna dengan kertas:{' '}
            <span className="rounded-cell bg-neutral px-1">kuning</span> = cek, <span className="rounded-cell bg-bad px-1 text-bad-ink">merah</span>{' '}
            = tidak lolos validasi. Warna hilang setelah field diubah.
          </p>
          {Object.keys(suggestions)
            .filter((k) => reasonOf(k))
            .map((k) => (
              <p key={k} className="text-bad-ink">
                • {reasonOf(k)}
              </p>
            ))}
        </div>
      )}
      <fieldset disabled={readOnly || busy} className="grid gap-4">
        <section className="grid gap-3 rounded-cell border border-grid bg-surface p-4 sm:grid-cols-3">
          <Field label="Serial No (wajib)">
            <Input
              value={serial}
              onChange={(e) => {
                setSerial(e.target.value.replace(/\D/g, ''));
                touch('serialNo')();
              }}
              inputMode="numeric"
              maxLength={5}
              required
              className={`num font-semibold ${hl('serialNo')}`}
            />
          </Field>
          <Field label="Tanggal resi">
            <Input name="receiptDate" type="date" defaultValue={v('receiptDate')} className={hl('receiptDate')} onInput={touch('receiptDate')} />
          </Field>
          {staff ? (
            <Field label="Sales">
              <Select name="salesId" defaultValue={initial?.sales.id ?? ''} required>
                <option value="" disabled>
                  Pilih sales
                </option>
                {sales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Sales">
              <Input value={initial?.sales.name ?? 'Anda'} disabled />
            </Field>
          )}
          {dup && (
            <div className="sm:col-span-3">
              <DuplicatePanel dup={dup} staff={staff} />
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-cell border border-grid bg-surface p-4 sm:grid-cols-3">
          <h2 className="text-panel font-semibold sm:col-span-3">Pengirim</h2>
          <Field label="Nama pengirim">
            <Input name="senderName" defaultValue={v('senderName')} placeholder="HANIPAH BT ADE" className={hl('senderName')} onInput={touch('senderName')} />
          </Field>
          <Field label="No paspor">
            <Input name="passportNo" defaultValue={v('passportNo')} placeholder="C8060823" autoComplete="off" className={hl('passportNo')} onInput={touch('passportNo')} />
          </Field>
          <Field label="No HP pengirim">
            <Input name="senderPhone" defaultValue={v('senderPhone')} inputMode="tel" autoComplete="off" className={hl('senderPhone')} onInput={touch('senderPhone')} />
          </Field>
        </section>

        <section className="grid gap-3 rounded-cell border border-grid bg-surface p-4 sm:grid-cols-3">
          <h2 className="text-panel font-semibold sm:col-span-3">Penerima</h2>
          <Field label="Nama penerima">
            <Input name="recipientName" defaultValue={v('recipientName')} className={hl('recipientName')} onInput={touch('recipientName')} />
          </Field>
          <Field label="No HP penerima (beberapa nomor dipisah spasi)">
            <Input name="recipientPhone" defaultValue={v('recipientPhone')} inputMode="tel" autoComplete="off" className={hl('recipientPhone')} onInput={touch('recipientPhone')} />
          </Field>
          <Field label="Tujuan (kab/kota)">
            <DestinationInput value={dest} onChange={setDest} disabled={readOnly} />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Alamat lengkap">
              <Input name="address" defaultValue={v('address')} placeholder="Kp. … Rt.05/06 Ds. … Kec. … Kab. …" className={hl('address')} onInput={touch('address')} />
            </Field>
          </div>
        </section>

        <section className="grid gap-3 rounded-cell border border-grid bg-surface p-4">
          <h2 className="text-panel font-semibold">Paket</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {PACKAGE_TYPES.map((p: PackageType) => (
              <Field key={p} label={PACKAGE_LABEL[p]}>
                <Input
                  name={`pkg_${p}`}
                  type="number"
                  min={0}
                  max={999}
                  defaultValue={initial?.packages[p] || suggestedPackages[p] || ''}
                  className={`num ${!initial && suggestedPackages[p] ? hl('packages') : ''}`}
                  onInput={touch('packages')}
                />
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Koli / total pcs (di kertas)">
              <Input name="koliTotal" type="number" min={0} defaultValue={v('koliTotal')} className={`num ${hl('koliTotal')}`} onInput={touch('koliTotal')} />
            </Field>
            <Field label="Berat (Kg)">
              <Input name="weightKg" type="number" min={0} step="0.01" defaultValue={v('weightKg')} className={`num ${hl('weightKg')}`} onInput={touch('weightKg')} />
            </Field>
            <div className="col-span-2">
              <Field label="Ket. / Cek (mis. Plus 1 (64627))">
                <Input name="cekNote" defaultValue={v('cekNote')} />
              </Field>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 rounded-cell border border-grid bg-surface p-4 sm:grid-cols-4">
          <h2 className="col-span-full text-panel font-semibold">Biaya (disimpan, tidak diekspor)</h2>
          {(['insurance', 'packing', 'vat', 'grandTotal'] as const).map((k) => (
            <Field key={k} label={{ insurance: 'Insurance', packing: 'Packing', vat: 'VAT', grandTotal: 'Grand total' }[k]}>
              <Input name={k} type="number" min={0} defaultValue={v(k)} className={`num ${hl(k)}`} onInput={touch(k)} />
            </Field>
          ))}
        </section>
      </fieldset>

      {warnings.map((w) => (
        <p key={w} className="rounded-cell bg-neutral px-3 py-2 text-neutral-ink">
          {w}
        </p>
      ))}
      <ErrorText>{error}</ErrorText>

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" value="save" disabled={busy || !!dup}>
            {initial ? 'Simpan perubahan' : onCreated ? 'Simpan & scan berikutnya' : staff ? 'Simpan resi' : 'Kirim ke Admin'}
          </Button>
          {!initial && !onCreated && (
            <Button type="submit" value="next" variant="secondary" disabled={busy || !!dup}>
              Simpan & input berikutnya
            </Button>
          )}
          <Link href={`/containers/${containerId}`} className="flex h-8 items-center px-3 text-green-800 hover:underline">
            Kembali ke sheet
          </Link>
        </div>
      )}
    </form>
  );
}
