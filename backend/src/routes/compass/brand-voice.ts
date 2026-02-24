import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { ingestContent } from '../../services/rag/ingestion.js';

const router = Router();

/**
 * Format brand voice into a text block for RAG embedding.
 */
function formatBrandVoiceForEmbedding(bv: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`Brand Voice Summary: ${bv.voice_summary}`);
  if (Array.isArray(bv.tone) && bv.tone.length > 0) {
    lines.push(`Tone: ${bv.tone.join(', ')}`);
  }
  if (Array.isArray(bv.personality) && bv.personality.length > 0) {
    lines.push(`Personality: ${bv.personality.join(', ')}`);
  }
  if (bv.writing_style) {
    lines.push(`Writing Style: ${bv.writing_style}`);
  }
  if (Array.isArray(bv.do_guidelines) && bv.do_guidelines.length > 0) {
    lines.push('DO:');
    for (const g of bv.do_guidelines) lines.push(`- ${g}`);
  }
  if (Array.isArray(bv.dont_guidelines) && bv.dont_guidelines.length > 0) {
    lines.push("DON'T:");
    for (const g of bv.dont_guidelines) lines.push(`- ${g}`);
  }
  if (bv.target_audience) {
    lines.push(`Target Audience: ${bv.target_audience}`);
  }
  if (bv.industry_context) {
    lines.push(`Industry Context: ${bv.industry_context}`);
  }
  if (Array.isArray(bv.example_excerpts) && bv.example_excerpts.length > 0) {
    lines.push('Example Excerpts:');
    for (const ex of bv.example_excerpts as Array<{ text: string; source?: string; why?: string }>) {
      lines.push(`"${ex.text}" — ${ex.source || 'Unknown source'}`);
      if (ex.why) lines.push(`  (${ex.why})`);
    }
  }
  return lines.join('\n');
}

/**
 * GET /api/compass/brand-voice?contract_id={id}
 * Get brand voice for a contract.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { contract_id } = req.query;
  if (!contract_id || typeof contract_id !== 'string') {
    res.status(400).json({ error: 'contract_id query parameter is required' });
    return;
  }

  // Client access check
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', contract_id)
      .single();

    if (!access) {
      res.status(403).json({ error: 'Access denied to this contract' });
      return;
    }
  }

  const { data, error } = await req.supabase
    .from('compass_brand_voice')
    .select('*')
    .eq('contract_id', contract_id)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Return null if no brand voice exists yet (not an error)
  res.json({ brand_voice: data || null });
});

/**
 * PUT /api/compass/brand-voice
 * Create or update (upsert) brand voice for a contract.
 */
router.put(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const {
      contract_id,
      voice_summary,
      tone,
      personality,
      writing_style,
      do_guidelines,
      dont_guidelines,
      example_excerpts,
      target_audience,
      industry_context,
    } = req.body;

    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }

    if (!voice_summary || typeof voice_summary !== 'string') {
      res.status(400).json({ error: 'voice_summary is required' });
      return;
    }

    // Check if one exists already
    const { data: existing } = await req.supabase
      .from('compass_brand_voice')
      .select('brand_voice_id')
      .eq('contract_id', contract_id)
      .maybeSingle();

    const payload = {
      contract_id,
      voice_summary,
      tone: tone || [],
      personality: personality || [],
      writing_style: writing_style || null,
      do_guidelines: do_guidelines || [],
      dont_guidelines: dont_guidelines || [],
      example_excerpts: example_excerpts || [],
      target_audience: target_audience || null,
      industry_context: industry_context || null,
      updated_at: new Date().toISOString(),
    };

    let data;
    let error;

    if (existing) {
      // Update
      const result = await req.supabase
        .from('compass_brand_voice')
        .update(payload)
        .eq('brand_voice_id', existing.brand_voice_id)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Insert
      const result = await req.supabase
        .from('compass_brand_voice')
        .insert({ ...payload, created_by: req.user.id })
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Embed into RAG knowledge base (non-blocking)
    if (data && process.env.OPENAI_API_KEY) {
      const content = formatBrandVoiceForEmbedding(data);
      ingestContent({
        contract_id,
        source_type: 'note',
        source_id: data.brand_voice_id,
        title: 'Brand Voice Document',
        content,
      }).catch((err) => {
        console.error('[BrandVoice] RAG embedding failed (non-blocking):', err);
      });
    }

    res.json({ brand_voice: data });
  }
);

export default router;
