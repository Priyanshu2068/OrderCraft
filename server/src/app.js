import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { crud } from './routes/crud.js';
import authRouter from './routes/auth.js';
import ordersRouter from './routes/orders.js';
import { bomRouter, workOrderRouter, purchaseRouter, invoiceRouter } from './routes/operations.js';
import reportRouter from './routes/reports.js';
import { portalRouter, portalAdminRouter, trackRouter } from './routes/portal.js';
import { HttpError } from './middleware/error.js';

const optStr = z.string().nullish().transform((v) => v ?? null);

const customers = crud({
  table: 'customers', writeRoles: ['sales'],
  schema: z.object({
    name: z.string().min(1), email: optStr, phone: optStr, billing_address: optStr, shipping_address: optStr,
    discount_pct: z.coerce.number().min(0).max(100).default(0),
  }),
});
const suppliers = crud({
  table: 'suppliers', writeRoles: ['planner', 'warehouse'],
  schema: z.object({ name: z.string().min(1), email: optStr, lead_time_days: z.coerce.number().int().min(0) }),
});
const products = crud({
  table: 'products', writeRoles: ['planner'],
  schema: z.object({
    sku: z.string().min(1), name: z.string().min(1),
    unit_price: z.coerce.number().min(0), lead_time_days: z.coerce.number().int().min(0),
  }),
});
const materials = crud({
  table: 'materials', writeRoles: ['planner', 'warehouse'], orderBy: 'code',
  schema: z.object({
    code: z.string().min(1), name: z.string().min(1), uom: z.string().min(1),
    stock_qty: z.coerce.number().min(0), reorder_level: z.coerce.number().min(0),
    unit_cost: z.coerce.number().min(0),
    supplier_id: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  }),
});

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/track', trackRouter);

  // everything below requires a valid token
  app.use('/api', authenticate);
  app.use('/api/portal', portalRouter);
  // customers may only use the portal
  app.use('/api', (req, _res, next) => {
    if (req.user.role === 'customer') throw new HttpError(403, 'Staff only');
    next();
  });
  app.use('/api/customers', portalAdminRouter);
  app.use('/api/customers', customers);
  app.use('/api/suppliers', suppliers);
  app.use('/api/products', bomRouter, products);
  app.use('/api/materials', materials);
  app.use('/api/orders', ordersRouter);
  app.use('/api/work-orders', workOrderRouter);
  app.use('/api/purchase-orders', purchaseRouter);
  app.use('/api/invoices', invoiceRouter);
  app.use('/api/reports', reportRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
