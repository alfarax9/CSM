import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { errorHandler } from '../src/http/errors.js';
import { requireRole } from '../src/http/rbac.js';

describe('api', () => {
  it('GET /api/v1/health', async () => {
    const res = await request(createApp({ env: loadEnv({ NODE_ENV: 'test' }) })).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'api' });
  });

  it('404 memakai format error seragam', async () => {
    const res = await request(createApp({ env: loadEnv({ NODE_ENV: 'test' }) })).get('/api/v1/tidak-ada');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('requireRole', () => {
  function appWith(role?: 'admin' | 'sales') {
    const app = express();
    app.use((req, _res, next) => {
      if (role) req.user = { id: 'u1', role, displayName: null };
      next();
    });
    app.post('/approve', requireRole('super_admin', 'admin'), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
  }

  it('menolak tanpa sesi', async () => {
    const res = await request(appWith()).post('/approve');
    expect(res.status).toBe(401);
  });

  it('menolak Sales untuk approve', async () => {
    const res = await request(appWith('sales')).post('/approve');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('mengizinkan Admin', async () => {
    const res = await request(appWith('admin')).post('/approve');
    expect(res.status).toBe(200);
  });
});
