import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env';
import { getDb } from './lib/http';
import { securityHeaders, csrfProtection } from './middleware/security';
import { sessionMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import setupRoutes from './routes/setup';
import readingsRoutes from './routes/readings';
import dashboardRoutes from './routes/dashboard';
import bookingRoutes from './routes/bookings';
import committeeRoutes from './routes/committee';
import guardRoutes from './routes/guard';
import uploadRoutes from './routes/uploads';
import residentRoutes from './routes/resident';
import adminRoutes from './routes/admin';

const app = new Hono<AppEnv>();

app.use('/api/*', securityHeaders);
app.use('/api/*', async (c, next) => {
  c.set('db', getDb(c.env.DB));
  await next();
});
app.use('/api/*', csrfProtection);
app.use('/api/*', sessionMiddleware);

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route('/api/auth', authRoutes);
app.route('/api/setup', setupRoutes);
app.route('/api/readings', readingsRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/bookings', bookingRoutes);
app.route('/api', committeeRoutes); // tanks, vendors, expenses, notices, complaints, municipal, reports, alerts
app.route('/api/guard', guardRoutes);
app.route('/api/uploads', uploadRoutes);
app.route('/api/resident', residentRoutes);
app.route('/api/admin', adminRoutes);

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Anything else is the React app: hand it to the static assets (SPA fallback serves index.html).
// The HTML shell is always re-fetched (no ETag/304) so a deploy is picked up immediately;
// the hashed /assets/* files it points to stay cached for a year.
app.get('*', async (c) => {
  const req = new Request(c.req.raw);
  req.headers.delete('If-None-Match');
  req.headers.delete('If-Modified-Since');
  const res = await c.env.ASSETS.fetch(req);
  if (!res.headers.get('Content-Type')?.includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.delete('ETag');
  out.headers.set('Cache-Control', 'no-cache');
  return out;
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error('Unhandled error', c.req.method, c.req.path, err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

export default app;
