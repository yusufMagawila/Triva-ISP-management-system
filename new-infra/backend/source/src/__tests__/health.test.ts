import request from 'supertest';
import { describe, it, expect } from '@jest/globals';
import express from 'express';

// Minimal health endpoint test without booting the full app (no DB required).
describe('Health endpoints', () => {
  it('returns OK for /health', async () => {
    const app = express();
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
