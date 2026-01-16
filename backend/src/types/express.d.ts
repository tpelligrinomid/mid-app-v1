import { SupabaseClient } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  auth_id: string;
  email: string;
  name: string;
  role: 'admin' | 'team_member' | 'client';
  status: 'active' | 'pending' | 'inactive';
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserProfile;
      supabase?: SupabaseClient;
    }
  }
}
