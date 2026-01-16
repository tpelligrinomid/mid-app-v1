import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /api/users/me
 * Get the current user's profile
 */
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    res.json({
      id: req.user.id,
      auth_id: req.user.auth_id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      status: req.user.status,
      avatar_url: req.user.avatar_url,
      created_at: req.user.created_at,
      updated_at: req.user.updated_at,
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

export default router;
