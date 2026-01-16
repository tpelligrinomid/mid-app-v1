# MiD Platform - Starter Prompts

These prompts are designed to bootstrap the new MiD Platform project.

**Reference docs:**
- `platform-rebuild-plan.md` - Full architecture and design decisions
- `technical-decisions.md` - Key technical decisions and patterns
- `schema.sql` - Database schema for Supabase

---

## 1. Frontend Prompt (Lovable)

Use this prompt in Lovable to create the initial frontend application:

```
Create a React application for a business platform at app.marketersindemand.com with the following structure:

## Branding
- No single product name - the platform contains modules: "Pulse" and "Compass"
- Internal users (admin/team_member) see both Pulse and Compass modes
- Client users only see "Pulse" (their client view) - they're told to "log into Pulse"
- Header shows module toggles, not a product name

## Tech Stack
- React + TypeScript + Tailwind CSS
- Supabase for authentication (Google OAuth + email/password)
- React Router for navigation
- Zustand for state management
- Axios or fetch for backend API calls

## Backend API
The backend API is deployed at: https://mid-app-v1.onrender.com

API endpoints require the user's Supabase JWT token in the Authorization header:
- GET /health - Health check (no auth)
- GET /api/users/me - Get current user profile
- GET /api/contracts - List contracts
- GET /api/contracts/:id - Contract detail
- GET /api/auth/quickbooks/status?agencyId=x - Check QuickBooks connection
- GET /api/auth/quickbooks/connections - List all QB connections

When making API calls:
```typescript
const response = await fetch('https://mid-app-v1.onrender.com/api/contracts', {
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json'
  }
});
```

## Application Shell Layout
The app has a unified shell with:
1. **Header** - Left side has mode toggle buttons "Pulse" and "Compass" (for internal users), right side has user menu dropdown
2. **Sidebar** (left) - Navigation that changes based on which mode is active
3. **Main Content Area** (right) - Where page content renders

## Mode Toggle Behavior (Internal Users: admin/team_member)
- **Pulse mode** (default): Global portfolio view - sidebar shows: Dashboard, Contracts, Financials, Tasks, Performance, Sync Status
- **Compass mode**: Contract workspace - requires selecting a contract first, then sidebar shows: Overview, Notes, Deliverables, Meetings, Knowledge

## Client User Experience
- Clients only see Pulse (their client view) - NO mode toggle shown
- They land directly in their contract view with: Dashboard, Tasks, Financials, Deliverables
- If they have access to multiple contracts, show a contract selector
- Future: Compass modules can be surfaced to clients when enabled

## Authentication
- Users must be logged in to access the app
- Support Google OAuth and email/password via Supabase
- After login, fetch user profile from backend API: GET /api/users/me
- The backend validates the token and returns the user's role (admin, team_member, client)
- Route based on role:
  - admin/team_member → /pulse/dashboard (with mode toggle visible)
  - client → /client/dashboard (Pulse client view, no mode toggle)

## User Profile Response
The /api/users/me endpoint returns:
```json
{
  "id": "uuid",
  "auth_id": "supabase-auth-uuid",
  "email": "user@example.com",
  "name": "User Name",
  "role": "admin" | "team_member" | "client",
  "status": "active",
  "avatar_url": "https://...",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

## Initial Routes
/login - Login page

# Internal user routes (admin/team_member)
/pulse/dashboard - Pulse dashboard (default landing)
/pulse/contracts - Contract list
/pulse/contracts/:id - Contract detail
/pulse/settings/integrations - Integration settings (QuickBooks, ClickUp connections)
/compass - Contract selector (if no contract selected)
/compass/:contractId/overview - Compass workspace

# Client routes
/client/dashboard - Client landing (contract selector if multiple, or single contract view)
/client/:contractId - Client contract view (tasks, financials, deliverables)

## Design
- Clean, professional UI
- Primary color: Purple (#7c3aed)
- Use shadcn/ui components
- Responsive sidebar (collapsible on mobile)

## API Helper Pattern
Create an api.ts utility that:
1. Gets the current Supabase session
2. Adds the Authorization header to all requests
3. Handles 401 responses by redirecting to login
4. Points to the backend URL from environment variable

```typescript
// src/lib/api.ts
const API_URL = import.meta.env.VITE_API_URL || 'https://mid-app-v1.onrender.com';

export async function apiClient(endpoint: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Session expired, redirect to login
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
}
```

Start with the shell layout, authentication flow, API utility, and basic routing. We'll add page content next.
```

### After Initial Build - Next Steps:
1. Supabase is already connected via Lovable
2. Configure Google OAuth in Supabase dashboard
3. Add environment variable: VITE_API_URL=https://mid-app-v1.onrender.com
4. Build out Pulse Dashboard page (fetches from /api/contracts)
5. Build Contracts list and detail pages
6. Build Settings/Integrations page (shows QuickBooks connections)
7. Build Compass workspace pages

---

## 2. Backend (Already Built)

The backend API is already built and located in the `/backend` folder of this repository.

**Repository:** https://github.com/tpelligrinomid/mid-app-v1.git

### Deployment on Render

| Setting | Value |
|---------|-------|
| **Root Directory** | `backend` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Language** | Node |

### Environment Variables for Render

**Required:**
| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `FRONTEND_URL` | Your Lovable app URL (for CORS) |

**QuickBooks (when ready):**
| Variable | Value |
|----------|-------|
| `QUICKBOOKS_CLIENT_ID` | From Intuit Developer Portal |
| `QUICKBOOKS_CLIENT_SECRET` | From Intuit Developer Portal |
| `QUICKBOOKS_REDIRECT_URI` | `https://mid-app-v1.onrender.com/api/auth/quickbooks/callback` |
| `QUICKBOOKS_ENVIRONMENT` | `production` |

**Other integrations (when ready):**
| Variable | Value |
|----------|-------|
| `CLICKUP_API_TOKEN` | From ClickUp Settings |
| `HUBSPOT_API_KEY` | From HubSpot Private Apps |

### Key Architecture Notes

- **No service role key** - Lovable manages Supabase, so all DB operations go through the user's authenticated client
- **RLS required** - Supabase RLS policies must allow the operations the backend performs
- **Multi-agency QuickBooks** - One QB app, multiple agency connections (tokens stored per agency)
- **OAuth callback auth** - User's JWT is encoded in OAuth state parameter to authenticate callbacks

See `technical-decisions.md` for full details.

---

## 3. Supabase Setup (After Lovable Creates Project)

Lovable auto-creates the Supabase project when you start the frontend. After that, you'll need to:

1. **Run schema.sql** in the Supabase SQL Editor to create all tables
2. **Enable Google OAuth** in Authentication → Providers
3. **Configure redirect URLs** for your Lovable app domain
4. **Set up RLS policies** - Critical for backend to function:

```sql
-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON users
  FOR SELECT USING (auth.uid() = auth_id);

-- Admin/team_member can read all contracts
CREATE POLICY "Internal users can read all contracts" ON contracts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role IN ('admin', 'team_member')
    )
  );

-- Admin/team_member can manage sync tokens
CREATE POLICY "Internal users can manage sync tokens" ON pulse_sync_tokens
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role IN ('admin', 'team_member')
    )
  );

-- Admin/team_member can read/update agencies
CREATE POLICY "Internal users can manage agencies" ON agencies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role IN ('admin', 'team_member')
    )
  );
```

---

## Build Order

**Important:** Lovable auto-creates the Supabase project via its integration. You won't have Supabase credentials until after step 1.

1. ⬜ **Create Lovable frontend** (use prompt #1) → This creates Supabase project
2. ⬜ **Get Supabase credentials** from Lovable dashboard or Supabase dashboard
3. ⬜ **Run schema.sql** in Supabase SQL Editor
4. ⬜ **Set up RLS policies** in Supabase (see section 3)
5. ✅ Backend already built in /backend folder
6. ⬜ **Deploy backend to Render** with Supabase credentials + Lovable URL
7. ⬜ **Add VITE_API_URL** to Lovable env vars pointing to Render backend
8. ⬜ Test authentication flow end-to-end
9. ⬜ Build Pulse module features
10. ⬜ Build Compass module features
11. ⬜ Connect QuickBooks for each agency
12. ⬜ Data migration from Pulse v1

---

*Updated: January 2025*
