/** Klien service ml internal (PRD §9): API → ml lewat HTTP; HF_TOKEN hanya di service ml. */

export interface SuggestedField {
  value: unknown;
  raw: unknown;
  level: 'neutral' | 'bad';
  reason: string | null;
}

export interface Extraction {
  model: string;
  seconds: number;
  inputTokens: number | null;
  outputTokens: number | null;
  fields: Record<string, SuggestedField>;
  raw: Record<string, unknown>;
}

export type Extractor = (jpeg: Buffer) => Promise<Extraction>;

export class ExtractorError extends Error {
  constructor(
    readonly unavailable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export function createMlExtractor(mlUrl: string, timeoutMs = 90_000): Extractor {
  return async (jpeg) => {
    let res: Response;
    try {
      res = await fetch(new URL('/ml/extract', mlUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64: jpeg.toString('base64') }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = (err as Error).name === 'TimeoutError';
      throw new ExtractorError(!timeout, timeout ? 'Model terlalu lama merespons.' : 'Service ml tidak bisa dihubungi.');
    }
    if (res.status === 404) throw new ExtractorError(true, 'Baca otomatis belum aktif (service ml perlu dijalankan ulang dengan versi terbaru).');
    if (!res.ok) {
      const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail;
      // 503 = tidak tersedia (HF_TOKEN kosong / kredit habis): pesan dari service ml diteruskan apa adanya.
      if (res.status === 503) throw new ExtractorError(true, detail ?? 'Baca otomatis belum aktif (HF_TOKEN belum di-set di service ml).');
      throw new ExtractorError(false, detail ?? `Service ml gagal (HTTP ${res.status}).`);
    }
    return (await res.json()) as Extraction;
  };
}
