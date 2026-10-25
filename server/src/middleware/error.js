import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const validate = (schema, data) => schema.parse(data);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // Postgres constraint violations
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists (duplicate value)' });
  if (err.code === '23503') return res.status(409).json({ error: 'Referenced by other records or reference not found' });
  if (err.code === '23514') return res.status(400).json({ error: 'Value violates a constraint' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
