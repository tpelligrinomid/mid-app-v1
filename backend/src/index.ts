import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { validateSupabaseConfig } from './utils/supabase.js';
import { authMiddleware } from './middleware/auth.js';

// Route imports
import usersRouter from './routes/users.js';
import contractsRouter from './routes/pulse/contracts.js';
import syncRouter from './routes/pulse/sync.js';
import quickbooksAuthRouter from './routes/auth/quickbooks.js';

// Validate required environment variables
validateSupabaseConfig();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration - supports multiple origins
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
];

// Add production frontend URL(s) from environment
if (process.env.FRONTEND_URL) {
  // Support comma-separated list of origins
  const urls = process.env.FRONTEND_URL.split(',').map(url => {
    url = url.trim();
    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return url;
  });
  allowedOrigins.push(...urls);
}

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, origin);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Auth routes (no auth middleware - these handle OAuth callbacks)
app.use('/api/auth/quickbooks', quickbooksAuthRouter);

// Protected routes (require authentication)
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/contracts', authMiddleware, contractsRouter);
app.use('/api/sync', authMiddleware, syncRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`MiD Platform API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

export default app;
