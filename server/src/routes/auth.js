import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';

const router = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const { rows: [user] } = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new HttpError(401, 'Invalid email or password');
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, role: user.role, customer_id: user.customer_id } });
});

router.get('/me', authenticate, (req, res) => res.json(req.user));

export default router;
