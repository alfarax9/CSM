import path from 'node:path';
import type { NextConfig } from 'next';

// Produksi: Caddy mengarahkan /api/* langsung ke Express. Dev: Next.js yang meneruskan.
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  // Dev dan build memakai folder berbeda, supaya `npm run build` tidak merusak `npm run dev` yang sedang jalan.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
