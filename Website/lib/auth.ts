import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, User, UserRole } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || '86400', 10);

export interface JWTPayload {
  userId: string; // UUID
  username: string;
  role: UserRole;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_MAX_AGE });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // Normalize role if uppercase/lowercase
    const role: UserRole = String(decoded.role || '').toUpperCase() === 'ADMIN' ? 'ADMIN' : 'WORKER';
    return {
      userId: String(decoded.userId || decoded.id),
      username: decoded.username,
      role,
    };
  } catch (error) {
    return null;
  }
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<User | null> {
  const result = await query<User>(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND is_active = TRUE',
    [username.trim()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    return null;
  }

  return user;
}

export async function getUserById(userId: string): Promise<User | null> {
  const result = await query<User>('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] || null;
}
