import jwt from 'jsonwebtoken';
import { HttpError } from './error.js';

export const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, name: user.name, customer_id: user.customer_id ?? null }, process.env.JWT_SECRET, { expiresIn: '30d' });

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  next();
}

// admin is always allowed
export const requireRole = (...roles) => (req, _res, next) => {
  if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
  throw new HttpError(403, 'Insufficient permissions');
};
