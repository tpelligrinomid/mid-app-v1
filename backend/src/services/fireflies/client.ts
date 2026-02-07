/**
 * Fireflies.ai GraphQL API Client
 *
 * Fetches meeting transcripts from Fireflies using their GraphQL API.
 *
 * Environment variable: FIREFLIES_API_KEY
 * API: https://api.fireflies.ai/graphql
 */

import type { FirefliesTranscript } from '../../types/meetings.js';

const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql';

interface FirefliesConfig {
  apiKey: string;
}

function getConfig(): FirefliesConfig {
  const apiKey = process.env.FIREFLIES_API_KEY;

  if (!apiKey) {
    throw new Error('FIREFLIES_API_KEY is required');
  }

  return { apiKey };
}

/**
 * Low-level GraphQL POST with Bearer auth and error handling
 */
async function firefliesFetch<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const config = getConfig();

  const response = await fetch(FIREFLIES_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Fireflies API error: ${response.status} - ${error}`);
  }

  const result = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (result.errors && result.errors.length > 0) {
    const messages = result.errors.map((e) => e.message).join('; ');
    throw new Error(`Fireflies GraphQL error: ${messages}`);
  }

  if (!result.data) {
    throw new Error('Fireflies API returned no data');
  }

  return result.data;
}

// GraphQL query for fetching a single transcript
const TRANSCRIPT_QUERY = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      date
      duration
      participants
      sentences {
        speaker_name
        text
        start_time
        end_time
      }
      summary {
        short_summary
        action_items
        outline
      }
      transcript_url
      audio_url
    }
  }
`;

interface FirefliesTranscriptResponse {
  transcript: {
    id: string;
    title: string;
    date: string; // Unix timestamp in ms as string, or ISO
    duration: number; // minutes
    participants: string[];
    sentences: Array<{
      speaker_name: string;
      text: string;
      start_time: number;
      end_time: number;
    }>;
    summary: {
      short_summary?: string;
      action_items?: string[];
      outline?: string[];
    } | null;
    transcript_url: string | null;
    audio_url: string | null;
  } | null;
}

/**
 * Fetch a transcript from Fireflies by ID
 *
 * Maps the raw GraphQL response to our FirefliesTranscript type.
 * Returns null if the transcript is not found.
 */
export async function fetchTranscript(
  transcriptId: string
): Promise<FirefliesTranscript | null> {
  const data = await firefliesFetch<FirefliesTranscriptResponse>(
    TRANSCRIPT_QUERY,
    { transcriptId }
  );

  if (!data.transcript) {
    return null;
  }

  const t = data.transcript;

  // Parse date: Fireflies returns Unix timestamp in ms as a number or string
  let dateStr: string;
  const dateNum = Number(t.date);
  if (!isNaN(dateNum) && dateNum > 1_000_000_000) {
    // Unix timestamp (ms if > 1e12, seconds if < 1e12)
    const ms = dateNum > 1e12 ? dateNum : dateNum * 1000;
    dateStr = new Date(ms).toISOString();
  } else {
    // Already an ISO string or other parseable format
    dateStr = new Date(t.date).toISOString();
  }

  return {
    id: t.id,
    title: t.title,
    date: dateStr,
    duration: t.duration,
    participants: t.participants || [],
    sentences: t.sentences || [],
    summary: t.summary || undefined,
    transcript_url: t.transcript_url || undefined,
    audio_url: t.audio_url || undefined,
  };
}
