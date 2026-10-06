import 'dotenv/config';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { initSocket } from './socket';
import { errorHandler, notFound } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth.routes';
import routerRoutes from './routes/router.routes';
import planRoutes from './routes/plan.routes';
import sessionRoutes from './routes/session.routes';
import paymentRoutes from './routes/payment.routes';
import portalRoutes from './routes/portal.routes';
import omadaRoutes from './routes/omada.routes';
import omadaSiteRoutes from './routes/omada-site.routes';
import bootstrapRoutes from './routes/bootstrap.routes';
import tplinkBootstrapRoutes from './routes/tplink-bootstrap.routes';
import tplinkRouterRoutes from './routes/tplink-router.routes';
import adminRoutes from './routes/admin.routes';
import voucherRoutes from './routes/voucher.routes';
import portalSettingsRoutes from './routes/portal-settings.routes';
import subscriptionRoutes from './routes/subscription.routes';
import paymentSettingsRoutes from './routes/payment-settings.routes';

// Background jobs
import { startSessionExpiryJob, startStalePendingCleanupJob } from './jobs/sessionExpiry.job';
import { startPaymentReconciliationJob } from './jobs/paymentReconciliation.job';
import { startSubscriptionCheckJob } from './jobs/subscriptionCheck.job';

const app = express();
const httpServer = http.createServer(app);

// ─── Socket.IO ────────────────────────────────────────────────────────────────

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [env.FRONTEND_URL, env.PORTAL_URL],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

initSocket(io);

// ─── Middleware ───────────────────────────────────────────────────────────────

// Trust the nginx reverse proxy so rate limiters and IP logging see real client IPs.
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false, // managed by frontend
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [env.FRONTEND_URL, env.PORTAL_URL].filter(Boolean);
      // Allow requests with no origin (server-to-server webhooks, health probes).
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Reject gracefully so Express error handlers don't return 500.
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// Capture raw body for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString();
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// Global rate limiter — skip for router bootstrap endpoints which call every 15 s.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later' },
    skip: (req) => req.path.startsWith('/bootstrap/'),
  })
);

// Stricter rate limiter for payment endpoints. Webhooks are intentionally
// included: the per-tenant token in the URL must be protected from brute-force,
// and legitimate providers send far fewer than 30 callbacks/min per source IP.
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { success: false, error: 'Too many payment requests' },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Readiness probe that actually exercises the database connection.
 *
 * A PostgreSQL restart (e.g. unattended-upgrades upgrading a package Postgres
 * links against) kills the Prisma pool with SQLSTATE 57P01, and Prisma does not
 * rebuild it -- every query then fails with P1017 "Server has closed the
 * connection" until the process is restarted. Plain /health stays 200 in that
 * state, so it cannot be used to detect the outage. This endpoint returns 503
 * so a supervisor can reload the process.
 */
app.get('/health/db', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'up', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('Health check: database unreachable', { err });
    res.status(503).json({
      status: 'error',
      db: 'down',
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/bootstrap/tplink', tplinkBootstrapRoutes);
app.use('/bootstrap', bootstrapRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/routers', routerRoutes);
app.use('/api/tplink-routers', tplinkRouterRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/payments', paymentLimiter, paymentRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/omada', omadaRoutes);
app.use('/api/omada-sites', omadaSiteRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/payment-settings', paymentSettingsRoutes);
app.use('/api/portal-settings', portalSettingsRoutes);
app.use('/api/vouchers', voucherRoutes);

// Webhook at root level for easy URL
app.use('/api/webhook', paymentRoutes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    // Start background jobs
    startSessionExpiryJob();
    startStalePendingCleanupJob();
    startPaymentReconciliationJob();
    startSubscriptionCheckJob();

    const port = parseInt(env.PORT, 10);
    httpServer.listen(port, () => {
      logger.info(`🚀 TRIVA backend running on port ${port} [${env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await prisma.$disconnect();
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

start();
