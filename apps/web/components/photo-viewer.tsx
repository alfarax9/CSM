'use client';

import { useState } from 'react';

/** Foto resi dengan zoom (PRD F3 kiri): klik untuk perbesar 2,5×, geser untuk melihat bagian lain. */
export function PhotoViewer({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div className="grid gap-1">
      <div className={`overflow-auto rounded-cell border border-grid bg-canvas ${zoom ? 'max-h-[75dvh]' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- URL bertanda tangan, tidak lewat optimizer */}
        <img
          src={src}
          alt={alt}
          onClick={() => setZoom((z) => !z)}
          className={zoom ? 'max-w-none cursor-zoom-out' : 'w-full cursor-zoom-in'}
          style={zoom ? { width: '250%' } : undefined}
        />
      </div>
      <p className="text-meta text-ink-muted">{zoom ? 'Klik foto untuk kembali.' : 'Klik foto untuk memperbesar.'}</p>
    </div>
  );
}
