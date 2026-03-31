import express from 'express';
import crypto from 'node:crypto';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import 'dotenv/config';

import authRoutes from './routes/auth.routes.js';
import proposalsRoutes from './routes/proposals.routes.js';
import templatesRoutes from './routes/templates.routes.js';
import metricsRoutes from './routes/metrics.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import mercadoPagoRoutes from './routes/mercadopago.routes.js';
import webhooksRoutes from './routes/webhooks.routes.js';
import { apiRateLimiter, sanitizeRequestBody, contractCreationRateLimiter } from './middleware/security.js';
import userRoutes from './routes/user.routes.js';
import copilotRoutes from './routes/copilot.routes.js';
import contractsRoutes from './routes/contracts.routes.js';
import clausesRoutes from './routes/clauses.routes.js';
import profileRoutes from './routes/profile.routes.js';
import scoreRoutes from './routes/score.routes.js';
import ratingRoutes from './routes/rating.routes.js';
import { csrfProtection } from './middleware/distributed-security.js';

const app = express();

app.disable('x-powered-by');

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  process.env.CORS_ORIGIN ||
  'http://localhost:5173,http://localhost:3000'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: false,
  })
);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) {
      return isProduction
        ? cb(new Error('CORS: origin ausente bloqueado em produção.'))
        : cb(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`CORS: origin não permitida: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'x-requested-with',
    'X-Step-Up-Token',
    'x-step-up-token',
    'X-CSRF-Token',
    'x-csrf-token',
    'idempotency-key',
    'Accept',
    'Origin',
    'Cache-Control',
    'Pragma',
    'Expires',
  ],
  exposedHeaders: [
    'set-cookie',
  ],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(cookieParser());

app.use((req, res, next) => {
  const requestId = req.header('x-request-id')?.trim() || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  (req as any).requestId = requestId;
  next();
});

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

app.use('/api/proposals/public', express.json({ limit: '4mb' }));
app.use('/api/contracts/public', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '25mb' }));

app.use(sanitizeRequestBody);
app.use(
  csrfProtection({
    allowedOrigins,
    exemptPaths: [
      '/api/health',
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/google',
      '/api/auth/refresh',
      '/api/auth/logout',
      '/api/webhooks/',
      '/api/payments/webhook',
      '/api/proposals/public/',
      '/api/payments/public/',
      '/api/mercadopago/callback',
    ],
  })
);
app.use('/api', apiRateLimiter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fechou-backend' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rotas de deception/honeypot (isoladas, sem acesso a serviços reais)
const deceptionRoutes = ['/admin', '/wp-admin', '/phpmyadmin', '/internal', '/debug', '/api/internal/status', '/api/admin/login'];
for (const path of deceptionRoutes) {
  app.all(path, (req, res) => {
    console.warn(JSON.stringify({
      event: 'deception_route_hit',
      severity: 'high',
      requestId: (req as any).requestId ?? null,
      route: req.originalUrl,
      method: req.method,
      ip: req.ip,
      ua: String(req.headers['user-agent'] ?? 'unknown').slice(0, 200),
    }));
    return res.status(404).json({ message: 'Not found' });
  });
}

app.use('/api/auth', authRoutes);
app.use('/api/proposals', proposalsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/mercadopago', mercadoPagoRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/user', userRoutes);
app.use('/api/copilot', copilotRoutes);
app.use('/api/contracts', contractCreationRateLimiter, contractsRoutes);
app.use('/api/clauses', clausesRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/score', scoreRoutes);
app.use('/api/ratings', ratingRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.message?.startsWith('CORS:')) {
    return res.status(403).json({
      message: err.message,
      allowedOrigins,
    });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ message: 'JSON inválido no corpo da requisição.' });
  }

  if (err?.status === 429) {
    return res.status(429).json({ message: err.message ?? 'Muitas requisições.' });
  }

  console.error('[ERROR]', err);

  return res.status(err?.status ?? 500).json({
    message:
      process.env.NODE_ENV === 'production'
        ? 'Erro interno no servidor.'
        : (err?.message ?? 'Erro interno no servidor.'),
  });
});

export default app;
