import { Request, Response, NextFunction } from 'express';
import { createUserClient } from '../utils/supabase.js';

/**
 * Authentication middleware that validates Supabase JWT tokens.
 *
 * Flow:
 * 1. Extract token from "Authorization: Bearer <token>"
 * 2. Create Supabase client with user's token
 * 3. Call getUser() to validate (Supabase verifies signature/expiry)
 * 4. Fetch user profile from "users" table using auth_id
 * 5. Reject if user status is "pending"
 * 6. Attach user profile and authenticated Supabase client to request
 *
 * NOTE: All operations use the user's authenticated client (no service role key).
 * RLS policy on "users" table must allow users to read their own profile.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7);

    // Create client with user's token
    const supabase = createUserClient(token);

    // Validate token by getting user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Fetch user profile from users table
    // RLS policy must allow: users can read their own profile (where auth_id = auth.uid())
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (profileError || !profile) {
      res.status(401).json({ error: 'User profile not found' });
      return;
    }

    // Reject pending users
    if (profile.status === 'pending') {
      res.status(403).json({
        error: 'Account pending approval',
        code: 'ACCOUNT_PENDING'
      });
      return;
    }

    // Attach to request
    req.user = profile;
    req.supabase = supabase;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Role-based access control middleware factory.
 * Use after authMiddleware.
 */
export function requireRole(...allowedRoles: Array<'admin' | 'team_member' | 'client'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        code: 'FORBIDDEN'
      });
      return;
    }

    next();
  };
}
