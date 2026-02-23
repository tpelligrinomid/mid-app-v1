/**
 * RAG Chat Route
 *
 * POST /api/compass/chat
 * Streams AI-powered answers grounded in the client's content library.
 *
 * Auth: authMiddleware (applied at mount in index.ts)
 * Contract access: verified inline via user_contract_access table
 */

import { Router, Request, Response } from 'express';
import { streamChatResponse } from '../../services/rag/chat.js';
import type { ChatMessage, SSEChunk } from '../../services/rag/chat.js';

const router = Router();

// UUID v4 regex for contract_id validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  // ── Validate input ──────────────────────────────────────────────────
  const { message, contract_id, conversation_history } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required and must be a non-empty string' });
    return;
  }

  if (!contract_id || typeof contract_id !== 'string' || !UUID_RE.test(contract_id)) {
    res.status(400).json({ error: 'contract_id is required and must be a valid UUID' });
    return;
  }

  // Validate conversation_history if provided
  let history: ChatMessage[] = [];
  if (conversation_history !== undefined) {
    if (!Array.isArray(conversation_history)) {
      res.status(400).json({ error: 'conversation_history must be an array' });
      return;
    }
    if (conversation_history.length > 20) {
      res.status(400).json({ error: 'conversation_history cannot exceed 20 messages' });
      return;
    }
    for (const msg of conversation_history) {
      if (!msg || typeof msg.content !== 'string' || (msg.role !== 'user' && msg.role !== 'assistant')) {
        res.status(400).json({ error: 'Each conversation_history entry must have role ("user"|"assistant") and content (string)' });
        return;
      }
    }
    history = conversation_history;
  }

  // ── Contract access check ───────────────────────────────────────────
  // For clients, verify they have access to this contract
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', contract_id)
      .single();

    if (!access) {
      res.status(403).json({ error: 'Access denied to this contract', code: 'CONTRACT_ACCESS_DENIED' });
      return;
    }
  }

  // ── Set SSE headers ─────────────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering if present
  });

  // Helper to write SSE events
  const sendEvent = (chunk: SSEChunk) => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  // Handle client disconnect
  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
  });

  try {
    await streamChatResponse(
      { message: message.trim(), contract_id, conversation_history: history },
      (chunk) => {
        if (!clientDisconnected) {
          sendEvent(chunk);
        }
      }
    );
  } catch (err) {
    console.error('[RAG Chat] Unhandled streaming error:', err);
    if (!clientDisconnected) {
      sendEvent({ type: 'error', message: 'An unexpected error occurred' });
    }
  } finally {
    if (!clientDisconnected) {
      res.end();
    }
  }
});

export default router;
