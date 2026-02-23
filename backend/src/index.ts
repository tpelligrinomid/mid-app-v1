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
import quickbooksPdfRouter from './routes/quickbooks-pdf.js';
import cronRouter from './routes/cron.js';
import webhooksRouter from './routes/webhooks.js';
import notesRouter from './routes/compass/notes.js';
import meetingsRouter from './routes/compass/meetings.js';
import reportsRouter from './routes/pulse/reports.js';
import statusReportsRouter from './routes/compass/status-reports.js';
import deliverablesRouter from './routes/compass/deliverables.js';
import processLibraryRouter from './routes/compass/process-library.js';
import contentRouter from './routes/compass/content.js';
import chatRouter from './routes/compass/chat.js';

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
app.use(express.json({ limit: '10mb' }));

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

// Cron routes (no auth middleware - authenticated via CRON_SECRET header)
app.use('/api/cron', cronRouter);

// Webhook routes (no auth middleware - authenticated via x-api-key header)
app.use('/api/webhooks', webhooksRouter);

// Protected routes (require authentication)
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/contracts', authMiddleware, contractsRouter);
app.use('/api/sync', authMiddleware, syncRouter);
app.use('/api/quickbooks', authMiddleware, quickbooksPdfRouter);

// Compass routes (require authentication)
app.use('/api/compass/notes', authMiddleware, notesRouter);
app.use('/api/compass/meetings', authMiddleware, meetingsRouter);

// Compass status reports (require authentication)
app.use('/api/compass/status-reports', authMiddleware, statusReportsRouter);

// Compass deliverables (require authentication)
app.use('/api/compass/deliverables', authMiddleware, deliverablesRouter);

// Compass process library (require authentication)
app.use('/api/compass/process-library', authMiddleware, processLibraryRouter);

// Compass content module (require authentication)
app.use('/api/compass/content', authMiddleware, contentRouter);

// Compass RAG chat (require authentication)
app.use('/api/compass/chat', authMiddleware, chatRouter);

// Pulse reports (require authentication)
app.use('/api/pulse/reports', authMiddleware, reportsRouter);

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
