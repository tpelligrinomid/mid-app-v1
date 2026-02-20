# Content Ops — Master Marketer Integration Spec

## Overview

The MiD Platform is building a Content Ops module in Compass. Master Marketer needs **three new capabilities** to support it:

1. **Content Generation** — generate blog posts, newsletters, etc. from a prompt template + context
2. **Idea Generation** — generate content ideas from a prompt + the client's content library
3. **Competitive Intelligence Digest** — scheduled weekly research on competitors + industry trends

All three follow the existing async job pattern: POST returns 202 with jobId, MM processes in the background, results delivered via callback webhook or polling.

---

## 1. Content Generation Endpoint

### `POST /api/generate/content-piece`

Generates a full content piece (blog post, newsletter, video script, etc.) using a prompt template, client context, and their content library.

### Request Payload

```json
{
  "client": {
    "company_name": "Acme Corp",
    "domain": "acme.com",
    "industry": "B2B SaaS",
    "brand_voice": "Professional but approachable. Data-driven. Thought leadership tone."
  },
  "content_type": "blog_post",
  "template": {
    "system_prompt": "You are an expert B2B content strategist writing for {{company_name}}...",
    "user_prompt": "Write a blog post about {{topic}}. Angle: {{angle}}. Target audience: {{audience}}.",
    "variables": {
      "topic": "How AI is transforming B2B marketing",
      "angle": "Practical applications, not hype",
      "audience": "VP Marketing and CMOs at mid-market SaaS companies"
    }
  },
  "context": {
    "reference_content": [
      {
        "title": "Our 2025 State of AI in Marketing Report",
        "content": "Full text of the client's existing published content...",
        "content_type": "whitepaper"
      },
      {
        "title": "Q4 Marketing Strategy Meeting",
        "content": "Meeting transcript excerpt about AI priorities...",
        "content_type": "meeting_transcript"
      }
    ],
    "library_context": [
      {
        "title": "Previous blog: 5 AI Tools Every Marketer Needs",
        "content": "Chunk of relevant content from RAG search...",
        "source_type": "content",
        "similarity": 0.89
      }
    ],
    "additional_instructions": "Focus on real examples from our industry. Reference our whitepaper findings where relevant. Keep it under 1500 words."
  },
  "output_format": {
    "format": "markdown",
    "include_meta_description": true,
    "include_social_snippets": true,
    "word_count_target": 1500
  },
  "callback_url": "https://mid-app-v1.onrender.com/api/webhooks/master-marketer/job-complete",
  "metadata": {
    "asset_id": "uuid",
    "contract_id": "uuid",
    "title": "AI in B2B Marketing Blog Post"
  }
}
```

### Key Fields Explained

| Field | Description |
|-------|-------------|
| `client` | Client context — company, industry, brand voice. Pulled from contract config. |
| `content_type` | What type of content to generate (blog_post, newsletter, video_script, social_media, case_study, etc.) |
| `template.system_prompt` | The system prompt with `{{variables}}` already resolved by MiD backend |
| `template.user_prompt` | The user prompt with `{{variables}}` already resolved |
| `context.reference_content` | **Manually selected** assets from the client's library — full content, hand-picked by the strategist |
| `context.library_context` | **Auto-retrieved** content chunks from RAG similarity search — relevant snippets found automatically |
| `context.additional_instructions` | Free-text instructions from the strategist |
| `output_format` | Desired output structure |
| `callback_url` | Standard MM callback — POST results here when done |
| `metadata` | Passed through to callback (asset_id, contract_id for routing) |

### Expected Response (202 Accepted)

```json
{
  "jobId": "uuid",
  "triggerRunId": "string",
  "status": "accepted",
  "message": "Content generation job queued"
}
```

### Expected Callback / Job Output

```json
{
  "content_body": "# How AI is Transforming B2B Marketing\n\nMarkdown content here...",
  "content_structured": {
    "title": "How AI is Transforming B2B Marketing",
    "meta_description": "Discover the practical ways AI is changing B2B marketing...",
    "social_snippets": {
      "linkedin": "AI isn't just hype — here's how B2B marketers are actually using it...",
      "twitter": "5 practical ways AI is transforming B2B marketing (no buzzwords) →"
    },
    "sections": [
      { "heading": "Introduction", "content": "..." },
      { "heading": "1. Predictive Lead Scoring", "content": "..." }
    ],
    "word_count": 1487,
    "tags_suggested": ["AI", "B2B marketing", "marketing automation"]
  }
}
```

The MiD backend stores `content_body` (the full markdown) and `content_structured` (the parsed/structured version) on the asset.

---

## 2. Idea Generation Endpoint

### `POST /api/generate/content-ideas`

Generates content ideas based on a prompt, the client's content library, and their strategic context.

### Request Payload

```json
{
  "client": {
    "company_name": "Acme Corp",
    "domain": "acme.com",
    "industry": "B2B SaaS",
    "brand_voice": "Professional but approachable."
  },
  "prompt": "Give me 5 blog post ideas about innovation in our industry",
  "count": 5,
  "content_type": "blog_post",
  "category": "thought_leadership",
  "context": {
    "library_content": [
      {
        "title": "Existing blog: Why B2B Needs to Innovate",
        "content": "Relevant chunk from RAG search...",
        "source_type": "content"
      },
      {
        "title": "Competitive Digest — Week of Feb 10",
        "content": "Competitor A launched a series on AI innovation. Competitor B published a whitepaper on...",
        "source_type": "competitive_intel"
      }
    ],
    "content_plan": "Q1 2026 content plan: Focus on thought leadership, AI trends, customer success stories. Target 4 blog posts/month.",
    "existing_ideas": [
      "10 Ways AI is Changing B2B Marketing",
      "Case Study: How Acme Increased Pipeline 40%",
      "The Future of ABM in 2026"
    ]
  },
  "callback_url": "https://mid-app-v1.onrender.com/api/webhooks/master-marketer/job-complete",
  "metadata": {
    "contract_id": "uuid",
    "request_type": "idea_generation"
  }
}
```

### Key Fields Explained

| Field | Description |
|-------|-------------|
| `prompt` | The strategist's idea generation prompt |
| `count` | How many ideas to generate |
| `content_type` | Optional filter — generate ideas for a specific content type |
| `category` | Optional filter — target a specific category |
| `context.library_content` | RAG chunks from the client's published content AND competitive intelligence digests. **Note:** chunks have a `source_type` field — `"content"` means client's own work (use for inspiration), `"competitive_intel"` means competitor research (use for gap analysis, do NOT replicate) |
| `context.content_plan` | Text from the client's content plan deliverable for strategic alignment |
| `context.existing_ideas` | List of existing idea titles to avoid duplicates |

### Expected Callback / Job Output

```json
{
  "ideas": [
    {
      "title": "Why Your Innovation Strategy Needs a Content Engine",
      "description": "Explore how content marketing fuels innovation by creating feedback loops with customers and prospects. Reference our whitepaper data.",
      "content_type": "blog_post",
      "category": "thought_leadership",
      "tags": ["innovation", "content strategy", "thought leadership"],
      "priority_suggestion": 4,
      "reasoning": "Competitor A hasn't covered this angle. Aligns with Q1 thought leadership focus."
    },
    {
      "title": "5 Innovation Lessons from Our Top Customers",
      "description": "Customer-driven innovation stories that double as social proof...",
      "content_type": "blog_post",
      "category": "customer_stories",
      "tags": ["innovation", "customer success"],
      "priority_suggestion": 3,
      "reasoning": "Customer stories are underrepresented in current library. High engagement potential."
    }
  ]
}
```

Each idea includes a `reasoning` field explaining *why* the AI suggested it — what gap it fills, what strategic priority it serves, or what competitive opportunity it addresses.

---

## 3. Competitive Intelligence Digest

### `POST /api/generate/competitive-digest`

Runs a competitive analysis for a client. Designed to be triggered on a schedule (weekly) or on-demand.

### Request Payload

```json
{
  "client": {
    "company_name": "Acme Corp",
    "domain": "acme.com",
    "industry": "B2B SaaS"
  },
  "competitors": [
    {
      "name": "Competitor A",
      "domain": "competitora.com",
      "blog_url": "https://competitora.com/blog",
      "social_urls": {
        "linkedin": "https://linkedin.com/company/competitora",
        "youtube": "https://youtube.com/@competitora"
      }
    },
    {
      "name": "Competitor B",
      "domain": "competitorb.io",
      "blog_url": "https://competitorb.io/resources"
    }
  ],
  "industry_keywords": ["B2B SaaS marketing", "marketing automation", "ABM", "AI marketing"],
  "research_config": {
    "lookback_days": 7,
    "include_blog_posts": true,
    "include_social_activity": true,
    "include_youtube": true,
    "include_industry_news": true
  },
  "callback_url": "https://mid-app-v1.onrender.com/api/webhooks/master-marketer/job-complete",
  "metadata": {
    "contract_id": "uuid",
    "config_id": "uuid",
    "request_type": "competitive_digest"
  }
}
```

### Research Approach

Use Exa.ai (or similar) to:
1. Search each competitor's blog for new posts in the lookback period
2. Check LinkedIn/YouTube for notable new content
3. Search industry keywords for trending articles and news
4. Synthesize everything into a structured digest

### Expected Callback / Job Output

```json
{
  "title": "Competitive Intelligence Digest — Week of Feb 17, 2026",
  "period": {
    "start": "2026-02-10",
    "end": "2026-02-16"
  },
  "content_body": "# Competitive Intelligence Digest — Week of Feb 17, 2026\n\n## Competitor Activity\n\n### Competitor A\n- Published blog post: \"Why ABM is Dead\" (Feb 12)\n  - Key argument: ...\n  - 2.4K LinkedIn shares\n\n### Competitor B\n- Launched new YouTube series on marketing automation\n  - Episode 1: 15K views in 3 days\n\n## Industry Trends\n\n### AI Marketing Adoption Accelerating\n- Forrester report: 67% of B2B marketers now use AI...\n\n## Content Opportunities\n\n1. **Counter-narrative to \"ABM is Dead\"** — Competitor A's hot take creates an opportunity for a thought leadership rebuttal\n2. **Video gap** — Neither competitor has video content on AI marketing tools\n3. **Rising keyword** — \"AI-powered content strategy\" search volume up 40% MoM",
  "content_structured": {
    "competitors": [
      {
        "name": "Competitor A",
        "new_content": [
          {
            "title": "Why ABM is Dead",
            "url": "https://competitora.com/blog/abm-is-dead",
            "type": "blog_post",
            "published_date": "2026-02-12",
            "summary": "Argues that traditional ABM approaches are failing...",
            "engagement": { "linkedin_shares": 2400 }
          }
        ],
        "notable_changes": ["New blog series on account-based strategies"]
      },
      {
        "name": "Competitor B",
        "new_content": [
          {
            "title": "Marketing Automation Masterclass - Episode 1",
            "url": "https://youtube.com/watch?v=...",
            "type": "youtube_video",
            "published_date": "2026-02-11",
            "summary": "Launch of educational video series...",
            "engagement": { "views": 15000 }
          }
        ],
        "notable_changes": ["Launched YouTube channel"]
      }
    ],
    "industry_trends": [
      {
        "topic": "AI Marketing Adoption",
        "summary": "Forrester report shows 67% of B2B marketers now use AI in some capacity...",
        "sources": [
          { "title": "Forrester: State of AI in Marketing", "url": "https://..." }
        ]
      }
    ],
    "content_opportunities": [
      {
        "opportunity": "Counter-narrative to 'ABM is Dead'",
        "reasoning": "Competitor A's hot take is generating discussion. A well-reasoned rebuttal would position the client as a thought leader.",
        "suggested_content_type": "blog_post",
        "suggested_category": "thought_leadership",
        "urgency": "high"
      },
      {
        "opportunity": "Video content on AI marketing tools",
        "reasoning": "Neither competitor has video content in this space. First-mover opportunity.",
        "suggested_content_type": "video_script",
        "suggested_category": "how_to",
        "urgency": "medium"
      }
    ]
  },
  "metadata": {
    "sources_checked": 15,
    "exa_queries_run": 8,
    "competitors_analyzed": 2,
    "lookback_days": 7
  }
}
```

### How It's Used

The MiD backend will:
1. Store the digest in `content_competitive_digests` table (separate from client content)
2. Embed `content_body` into `compass_knowledge` with `source_type: 'competitive_intel'`
3. When generating ideas, competitive intel chunks surface via RAG for inspiration and gap analysis
4. The `content_opportunities` are especially valuable — they provide data-backed suggestions

**Important:** Competitive intel is embedded with a **different source type** (`competitive_intel`) than client content (`content`). This ensures the AI never confuses competitor material with the client's own work. Competitor content should inspire and inform, but never be quoted or directly repurposed.

---

## Scheduling

The competitive digest should support being triggered:
1. **On-demand** — strategist clicks "Run now" in the MiD UI
2. **Scheduled** — weekly (default), biweekly, or monthly, configured per contract

For scheduled runs, the MiD backend will trigger the job via cron. MM just needs to handle the POST whenever it arrives.

---

## Summary of New Endpoints Needed

| Endpoint | Purpose | Priority |
|----------|---------|----------|
| `POST /api/generate/content-piece` | Generate blog posts, newsletters, etc. | High — core feature |
| `POST /api/generate/content-ideas` | Generate content ideas from prompt + context | High — core feature |
| `POST /api/generate/competitive-digest` | Competitive analysis + industry digest | Medium — can follow |

All follow the existing MM pattern: async job → 202 response → callback/poll for results.
