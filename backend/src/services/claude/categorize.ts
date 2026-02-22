/**
 * Content Categorization via Claude
 *
 * Analyzes content body + title and returns suggested content type, category,
 * and enriched metadata. Returns null on any failure so the caller
 * can gracefully skip categorization.
 */

import { sendMessage } from './client.js';

const MAX_CONTENT_CHARS = 4000;

export interface CategorizationResult {
  content_type_slug: string;
  category_slug: string;
  metadata: {
    ai_summary: string;
    ai_word_count: number;
    ai_key_themes: string[];
    ai_tags: string[];
    ai_categorized_at: string;
    ai_confidence: { content_type: number; category: number };
  };
}

const SYSTEM_PROMPT = `You are a content classification engine. Analyze the given content and return a JSON object with categorization data.

Available content types (use the slug):
- blog_post: Long-form blog article
- newsletter: Email newsletter issue
- social_media: Social media post or campaign
- video_script: Script for video content
- podcast_episode: Podcast episode script or outline
- case_study: Customer success case study
- whitepaper: In-depth industry whitepaper
- ebook: Downloadable ebook or guide
- infographic: Visual infographic content
- webinar: Webinar presentation or script

Available categories (use the slug):
- thought_leadership: Expert opinions and industry insights
- product_marketing: Product features, launches, and updates
- customer_stories: Case studies and testimonials
- industry_news: Industry trends and news commentary
- how_to: Tutorials and instructional content
- company_culture: Brand culture and team stories

Return ONLY valid JSON (no markdown fences, no extra text) with this exact shape:
{
  "content_type_slug": "<slug>",
  "category_slug": "<slug>",
  "ai_tags": ["tag1", "tag2", ...],
  "ai_summary": "<2-3 sentence summary>",
  "ai_key_themes": ["theme1", "theme2", ...],
  "confidence": { "content_type": <0.0-1.0>, "category": <0.0-1.0> }
}

Rules:
- ai_tags: 3-7 lowercase, hyphen-separated tags relevant to the content
- ai_key_themes: 2-5 high-level themes
- ai_summary: concise 2-3 sentence summary of the content
- confidence: your confidence in each classification (0.0 to 1.0)
- Pick the BEST matching type and category even if the fit isn't perfect`;

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export async function categorizeContent(
  contentBody: string,
  title: string
): Promise<CategorizationResult | null> {
  try {
    const truncated = contentBody.length > MAX_CONTENT_CHARS
      ? contentBody.substring(0, MAX_CONTENT_CHARS) + '...'
      : contentBody;

    const userMessage = `Title: ${title}\n\nContent:\n${truncated}`;

    const responseText = await sendMessage(SYSTEM_PROMPT, userMessage, {
      maxTokens: 512,
      temperature: 0.2,
    });

    // Strip markdown fences if present
    const cleaned = responseText.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as {
      content_type_slug: string;
      category_slug: string;
      ai_tags: string[];
      ai_summary: string;
      ai_key_themes: string[];
      confidence: { content_type: number; category: number };
    };

    const wordCount = countWords(contentBody);

    return {
      content_type_slug: parsed.content_type_slug,
      category_slug: parsed.category_slug,
      metadata: {
        ai_summary: parsed.ai_summary,
        ai_word_count: wordCount,
        ai_key_themes: parsed.ai_key_themes,
        ai_tags: parsed.ai_tags,
        ai_categorized_at: new Date().toISOString(),
        ai_confidence: parsed.confidence,
      },
    };
  } catch (err) {
    console.error('[Categorization] Failed to categorize content:', err);
    return null;
  }
}
