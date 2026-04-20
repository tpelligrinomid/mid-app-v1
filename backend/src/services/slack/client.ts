/**
 * Minimal Slack posting helper.
 *
 * Uses a bot token (xoxb-...) from SLACK_BOT_TOKEN. Bot needs the
 * chat:write scope, plus chat:write.public if posting to channels it
 * hasn't been invited to.
 */

interface SlackPostResult {
  ok: boolean;
  error?: string;
  ts?: string;
}

export async function postSlackMessage(params: {
  channel: string;
  text: string;
  blocks?: unknown[];
}): Promise<SlackPostResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: 'SLACK_BOT_TOKEN not configured' };
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: params.channel,
      text: params.text,
      ...(params.blocks ? { blocks: params.blocks } : {}),
    }),
  });

  const data = (await response.json()) as { ok: boolean; error?: string; ts?: string };
  return data;
}
