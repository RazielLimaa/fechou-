import express from 'express';
import cors from 'cors';
import "dotenv/config";
import authRoutes from './routes/auth.routes.js';
import proposalsRoutes from './routes/proposals.routes.js';
import templatesRoutes from './routes/templates.routes.js';
import metricsRoutes from './routes/metrics.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import mercadoPagoRoutes from './routes/mercadopago.routes.js';
import webhooksRoutes from './routes/webhooks.routes.js';
import { apiRateLimiter, sanitizeRequestBody } from './middleware/security.js';

const app = express();
const corsOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
  const allowlist = [
    "http://http://127.0.0.1:5173", // Vite (dev)
    "http://localhost:5174", // se às vezes muda
    process.env.FRONTEND_URL, // produção (ex: https://fechou.app)
  ].filter(Boolean) as string[];

  // requests sem origin (curl/postman) -> permitir
  if (!origin) return cb(null, true);

  if (allowlist.includes(origin)) return cb(null, true);

  return cb(new Error(`CORS blocked for origin: ${origin}`));
};


app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl/postman
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.options("*", cors());

app.use(express.json({ limit: '30kb' }));
app.use(sanitizeRequestBody);
app.use('/api', apiRateLimiter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fechou-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/proposals', proposalsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/mercadopago', mercadoPagoRoutes);
app.use('/api/webhooks', webhooksRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ message: 'JSON inválido no corpo da requisição.' });
  }

  console.error(err);
  return res.status(500).json({ message: 'Erro interno no servidor.' });
});

export default app;
