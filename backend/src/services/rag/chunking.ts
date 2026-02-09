/**
 * Content Chunking Service
 *
 * Splits text into embeddable chunks with configurable size and overlap.
 * Target: ~500 tokens per chunk. Hard cap at 6000 tokens (model limit is 8191).
 *
 * Uses character-based token estimation (chars / 3) for reliability with
 * diverse content like meeting transcripts with timestamps and speaker labels.
 */

import type { TextChunk, ChunkingOptions } from '../../types/rag.js';

const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_OVERLAP_SENTENCES = 2;
// text-embedding-3-small has 8191 token limit; chars/3 is conservative
// so 6000 estimated tokens ≈ 18,000 chars ≈ ~6000 actual tokens max
const HARD_TOKEN_CAP = 6000;

/**
 * Conservative token estimate using character count.
 * cl100k_base averages ~4 chars/token for English, ~3 for mixed content.
 * We use chars/3 (pessimistic) to avoid exceeding the 8191 token limit.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Split text into sentences (basic sentence boundary detection)
 */
function splitSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences;
}

/**
 * Split text into paragraphs, falling back to single line breaks
 */
function splitParagraphs(text: string): string[] {
  // Try double line breaks first
  let parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // If we got one giant block, try single line breaks
  if (parts.length === 1 && estimateTokens(parts[0]) > HARD_TOKEN_CAP) {
    parts = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
  }

  return parts;
}

/**
 * Detect section headings in text and extract metadata
 */
function detectHeading(paragraph: string): string | null {
  const mdMatch = paragraph.match(/^#{1,6}\s+(.+)$/m);
  if (mdMatch) return mdMatch[1];

  const lines = paragraph.split('\n');
  if (lines.length === 1 && lines[0].length < 80 && lines[0] === lines[0].toUpperCase() && /[A-Z]/.test(lines[0])) {
    return lines[0];
  }

  return null;
}

/**
 * Hard-split text by word count when all other splitting fails.
 * Guarantees no chunk exceeds maxWords.
 */
function hardSplitByWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];

  for (let i = 0; i < words.length; i += maxWords) {
    parts.push(words.slice(i, i + maxWords).join(' '));
  }

  return parts;
}

/**
 * Chunk text into embeddable segments
 *
 * Strategy:
 * 1. Split by paragraphs first (double line breaks, then single)
 * 2. If a paragraph exceeds max_tokens, split by sentences
 * 3. If a sentence is still too long, hard-split by words
 * 4. Carry overlap_sentences from previous chunk for context continuity
 */
export function chunkText(text: string, options?: ChunkingOptions): TextChunk[] {
  const maxTokens = options?.max_tokens ?? DEFAULT_MAX_TOKENS;
  const overlapSentences = options?.overlap_sentences ?? DEFAULT_OVERLAP_SENTENCES;

  if (!text || text.trim().length === 0) {
    return [];
  }

  // If the entire text fits in one chunk, return as-is
  if (estimateTokens(text) <= maxTokens) {
    return [{
      content: text.trim(),
      chunk_index: 0,
      metadata: {},
    }];
  }

  const paragraphs = splitParagraphs(text);
  const chunks: TextChunk[] = [];
  let currentContent = '';
  let currentHeading: string | null = null;
  let overlapBuffer: string[] = [];

  function flushChunk() {
    let content = currentContent.trim();
    if (!content) return;

    // Safety: if a chunk is still too large, hard-split by words
    // 6000 tokens * 3 chars/token = 18000 chars; ~2000 words is safe
    if (estimateTokens(content) > HARD_TOKEN_CAP) {
      const maxWords = 2000;
      const subParts = hardSplitByWords(content, maxWords);
      for (const part of subParts) {
        chunks.push({
          content: part,
          chunk_index: chunks.length,
          metadata: currentHeading ? { section: currentHeading } : {},
        });
      }
      overlapBuffer = [];
      currentContent = '';
      return;
    }

    chunks.push({
      content,
      chunk_index: chunks.length,
      metadata: currentHeading ? { section: currentHeading } : {},
    });

    const sentences = splitSentences(content);
    overlapBuffer = sentences.slice(-overlapSentences);
    currentContent = '';
  }

  for (const paragraph of paragraphs) {
    const heading = detectHeading(paragraph);
    if (heading) {
      currentHeading = heading;
    }

    const paragraphTokens = estimateTokens(paragraph);

    // If this single paragraph is too large, split by sentences
    if (paragraphTokens > maxTokens) {
      if (currentContent) {
        flushChunk();
      }

      const sentences = splitSentences(paragraph);

      // If sentence splitting didn't help (e.g., one giant run-on), hard-split
      if (sentences.length <= 1 && paragraphTokens > HARD_TOKEN_CAP) {
        const maxWords = 2000;
        const subParts = hardSplitByWords(paragraph, maxWords);
        for (const part of subParts) {
          currentContent = part;
          flushChunk();
        }
        continue;
      }

      let sentenceBuffer = overlapBuffer.length > 0 ? [...overlapBuffer] : [];
      overlapBuffer = [];

      for (const sentence of sentences) {
        sentenceBuffer.push(sentence);
        const bufferText = sentenceBuffer.join(' ');

        if (estimateTokens(bufferText) > maxTokens && sentenceBuffer.length > 1) {
          sentenceBuffer.pop();
          currentContent = sentenceBuffer.join(' ');
          flushChunk();
          sentenceBuffer = [...overlapBuffer, sentence];
        }
      }

      if (sentenceBuffer.length > 0) {
        currentContent = sentenceBuffer.join(' ');
      }
      continue;
    }

    const withParagraph = currentContent
      ? `${currentContent}\n\n${paragraph}`
      : (overlapBuffer.length > 0 ? `${overlapBuffer.join(' ')}\n\n${paragraph}` : paragraph);

    if (estimateTokens(withParagraph) > maxTokens && currentContent) {
      flushChunk();
      currentContent = overlapBuffer.length > 0
        ? `${overlapBuffer.join(' ')}\n\n${paragraph}`
        : paragraph;
      overlapBuffer = [];
    } else {
      currentContent = withParagraph;
      if (!currentContent && overlapBuffer.length > 0) {
        overlapBuffer = [];
      }
    }
  }

  if (currentContent.trim()) {
    flushChunk();
  }

  return chunks;
}
