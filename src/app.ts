import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth.routes.js';
import proposalsRoutes from './routes/proposals.routes.js';
import templatesRoutes from './routes/templates.routes.js';
import metricsRoutes from './routes/metrics.routes.js';
import { apiRateLimiter, sanitizeRequestBody } from './middleware/security.js';

const app = express();

const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? true;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false
  })
);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
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

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ message: 'JSON inválido no corpo da requisição.' });
  }

  console.error(err);
  return res.status(500).json({ message: 'Erro interno no servidor.' });
});

export default app;
