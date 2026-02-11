import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import proposalsRoutes from './routes/proposals.routes.js';
import templatesRoutes from './routes/templates.routes.js';
import metricsRoutes from './routes/metrics.routes.js';

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fechou-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/proposals', proposalsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/metrics', metricsRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  return res.status(500).json({ message: 'Erro interno no servidor.' });
});

export default app;
