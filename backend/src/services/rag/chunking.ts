/**
 * Content Chunking Service
 *
 * Splits text into embeddable chunks with configurable size and overlap.
 * Target: 500-1000 tokens per chunk (approximated via word count / 0.75).
 */

import type { TextChunk, ChunkingOptions } from '../../types/rag.js';

const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_OVERLAP_SENTENCES = 2;

/**
 * Approximate token count from text (words / 0.75 is a rough estimate for English)
 */
function estimateTokens(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount / 0.75);
}

/**
 * Split text into sentences (basic sentence boundary detection)
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences;
}

/**
 * Split text into paragraphs
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Detect section headings in text and extract metadata
 */
function detectHeading(paragraph: string): string | null {
  // Markdown headings
  const mdMatch = paragraph.match(/^#{1,6}\s+(.+)$/m);
  if (mdMatch) return mdMatch[1];

  // All-caps short lines (likely headings)
  const lines = paragraph.split('\n');
  if (lines.length === 1 && lines[0].length < 80 && lines[0] === lines[0].toUpperCase() && /[A-Z]/.test(lines[0])) {
    return lines[0];
  }

  return null;
}

/**
 * Chunk text into embeddable segments
 *
 * Strategy:
 * 1. Split by paragraphs first
 * 2. If a paragraph exceeds max_tokens, split by sentences
 * 3. Carry overlap_sentences from previous chunk into next for context continuity
 * 4. Track section headings in chunk metadata
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
  let overlapBuffer: string[] = []; // sentences to carry forward

  function flushChunk() {
    const content = currentContent.trim();
    if (!content) return;

    chunks.push({
      content,
      chunk_index: chunks.length,
      metadata: currentHeading ? { section: currentHeading } : {},
    });

    // Extract last N sentences for overlap
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
      // Flush any accumulated content first
      if (currentContent) {
        flushChunk();
      }

      const sentences = splitSentences(paragraph);
      let sentenceBuffer = overlapBuffer.length > 0 ? [...overlapBuffer] : [];
      overlapBuffer = [];

      for (const sentence of sentences) {
        sentenceBuffer.push(sentence);
        const bufferText = sentenceBuffer.join(' ');

        if (estimateTokens(bufferText) > maxTokens && sentenceBuffer.length > 1) {
          // Remove last sentence and flush
          sentenceBuffer.pop();
          currentContent = sentenceBuffer.join(' ');
          flushChunk();
          sentenceBuffer = [...overlapBuffer, sentence];
        }
      }

      // Remaining sentences
      if (sentenceBuffer.length > 0) {
        currentContent = sentenceBuffer.join(' ');
      }
      continue;
    }

    // Check if adding this paragraph would exceed the limit
    const withParagraph = currentContent
      ? `${currentContent}\n\n${paragraph}`
      : (overlapBuffer.length > 0 ? `${overlapBuffer.join(' ')}\n\n${paragraph}` : paragraph);

    if (estimateTokens(withParagraph) > maxTokens && currentContent) {
      flushChunk();
      // Start new chunk with overlap + current paragraph
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

  // Flush remaining content
  if (currentContent.trim()) {
    flushChunk();
  }

  return chunks;
}
