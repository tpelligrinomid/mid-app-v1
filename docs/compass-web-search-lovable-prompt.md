# Lovable Prompt: Compass Chat — Web Search Progress and Web Sources

Compass chat can now search the web and read web pages while it answers. The backend is live; the chat stream (`POST /api/compass/chat`, Server-Sent Events) has two new event types. Nothing else about the stream changed: `context`, `delta`, `done` and `error` work exactly as before.

Please update the Compass chat UI to handle them.

---

## 1. New event: `status`

Sent while Compass is searching or reading a page, before or between the answer's text. There can be several in one answer.

```
data: {"type":"status","message":"Searching the web for \"B2B marketing agencies vertical SaaS\""}
data: {"type":"status","message":"Reading https://example.com/agency-list"}
```

**UI:**
- While the assistant message is still in progress, show the latest `status` message in place of (or next to) the typing indicator, in small muted text with a subtle globe or search icon. Example: 🔍 *Searching the web for "B2B marketing agencies vertical SaaS"…*
- Replace it with each new `status` event (show only the most recent one).
- Hide it once `done` or `error` arrives. Don't keep status lines in the finished message.
- Searches can take several seconds each, so this is what tells the user Compass is working rather than stuck.

## 2. New event: `web_sources`

Sent once, just before `done`, only when the answer used the web. Each source is a page the answer cited or read.

```
data: {"type":"web_sources","sources":[{"title":"Top B2B Agencies for SaaS in 2026","url":"https://example.com/top-agencies"},{"title":"Agency X — Case Studies","url":"https://agencyx.com/work"}]}
```

**UI:**
- Show these in the existing **Sources** section under the answer, as a separate group labeled **Web** below the library sources (deliverables, meetings, content).
- Each web source is a link: the title as link text, opening `url` in a new tab (`target="_blank" rel="noopener noreferrer"`). Under the title, show the domain in small muted text (e.g. `example.com`). Use a globe icon instead of the document icon.
- Web sources have no similarity score, so don't show a percentage badge for them.
- Update the count to include both groups, e.g. "Sources (2 matched · 3 web)".
- If an answer has only web sources (no library matches), show just the Web group.
- Keep the existing collapse rule: collapsed with an expand toggle when there are more than 3 sources in total.

## 3. Implementation notes

In the stream handler's `switch (data.type)`, add:

```ts
case 'status':
  setStatusMessage(data.message);
  break;
case 'web_sources':
  setWebSources(data.sources); // Array<{ title: string; url: string }>
  break;
```

Clear `statusMessage` on `done` and `error`. Store `webSources` on the assistant message alongside the existing `sources`, so they still render when scrolling back through the conversation.

Unknown event types should keep being ignored, so later additions don't break the chat.
