-- Migration 011: Content Prompt Sequences (Phase 2)
-- Table: content_prompt_sequences — multi-step prompt pipelines per content type
-- Run in Supabase SQL Editor

-- ============================================================================
-- content_prompt_sequences — Prompt pipelines tied to content types
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_prompt_sequences (
    sequence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),  -- NULL = global default
    content_type_slug text NOT NULL,       -- e.g. 'blog_post', 'newsletter'
    name text NOT NULL,                    -- "Standard Blog Post"
    description text,
    steps jsonb NOT NULL DEFAULT '[]',     -- ordered array of prompt steps
    variables jsonb NOT NULL DEFAULT '[]', -- template variables shared across steps
    is_default boolean DEFAULT false,      -- default sequence for this content type
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_prompt_seq_contract ON content_prompt_sequences(contract_id);
CREATE INDEX IF NOT EXISTS idx_prompt_seq_type_slug ON content_prompt_sequences(content_type_slug);
CREATE INDEX IF NOT EXISTS idx_prompt_seq_contract_type ON content_prompt_sequences(contract_id, content_type_slug);

-- ============================================================================
-- Seed global default prompt sequences (contract_id = NULL)
-- ============================================================================

-- Blog Post — Standard (2-step: draft + review)
INSERT INTO content_prompt_sequences (contract_id, content_type_slug, name, description, is_default, sort_order, steps, variables)
VALUES (
    NULL,
    'blog_post',
    'Standard Blog Post',
    'Two-step pipeline: draft a comprehensive blog post, then review and polish for quality.',
    true,
    1,
    $steps$[
        {
            "step_order": 1,
            "name": "draft",
            "system_prompt": "You are an expert content writer for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. Write in markdown format with clear structure.",
            "user_prompt": "Write a comprehensive blog post.\n\nTopic: {{topic}}\nAngle: {{angle}}\nTarget Audience: {{audience}}\n\nRequirements:\n- Compelling introduction that hooks the reader\n- Well-structured body with clear H2 and H3 headings\n- Data-driven arguments grounded in the provided reference materials\n- Practical takeaways the reader can act on\n- Strong conclusion with a call to action\n\nAt the end, include a JSON metadata block with:\n- meta_description (under 160 characters)\n- social_snippets: { linkedin, twitter }\n- tags_suggested: string[]",
            "output_key": "draft"
        },
        {
            "step_order": 2,
            "name": "review",
            "system_prompt": "You are a senior content editor. Review and improve content for clarity, engagement, accuracy, and brand alignment. Maintain the author's voice while elevating quality.",
            "user_prompt": "Review and improve this blog post draft:\n\n{{step:draft}}\n\nEdit for:\n1. Clarity and readability — simplify complex sentences, improve flow between sections\n2. Engagement — strengthen the hook, add compelling transitions\n3. Accuracy — flag or remove any unsupported claims\n4. SEO — ensure natural keyword usage and good heading structure\n5. Brand voice — ensure it matches the company's tone\n\nReturn the complete improved blog post in the same format (markdown body + JSON metadata block).",
            "output_key": "final"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "topic", "label": "Topic", "type": "text", "required": true},
        {"name": "angle", "label": "Angle", "type": "text", "required": true},
        {"name": "audience", "label": "Target Audience", "type": "text", "required": true}
    ]$vars$::jsonb
);

-- Blog Post — Thought Leadership (2-step: draft + review)
INSERT INTO content_prompt_sequences (contract_id, content_type_slug, name, description, is_default, sort_order, steps, variables)
VALUES (
    NULL,
    'blog_post',
    'Thought Leadership',
    'Authoritative opinion piece with strong point of view. Draft then review for argument strength.',
    false,
    2,
    $steps$[
        {
            "step_order": 1,
            "name": "draft",
            "system_prompt": "You are a thought leadership ghostwriter for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. Write with authority, original perspective, and industry expertise. Your goal is to position the company as an industry leader.",
            "user_prompt": "Write a thought leadership article.\n\nTopic: {{topic}}\nKey Argument: {{key_argument}}\nTarget Audience: {{audience}}\n\nRequirements:\n- Open with a bold, contrarian, or forward-looking statement\n- Build a structured argument with evidence from the provided reference materials\n- Include original insights — not just a summary of what others have said\n- Reference industry trends and data points\n- End with a clear call to action or vision for the future\n\nAt the end, include a JSON metadata block with:\n- meta_description (under 160 characters)\n- social_snippets: { linkedin, twitter }\n- tags_suggested: string[]",
            "output_key": "draft"
        },
        {
            "step_order": 2,
            "name": "review",
            "system_prompt": "You are a senior content strategist reviewing thought leadership content. Focus on argument strength, originality, and executive-level readability.",
            "user_prompt": "Review and strengthen this thought leadership article:\n\n{{step:draft}}\n\nEdit for:\n1. Argument strength — ensure claims are well-supported and the logic flows\n2. Originality — flag any generic takes; push for more distinctive perspective\n3. Authority — ensure the tone is confident without being arrogant\n4. Executive readability — busy leaders should be able to skim headings and get the gist\n5. CTA — strengthen the closing call to action\n\nReturn the complete improved article in the same format.",
            "output_key": "final"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "topic", "label": "Topic", "type": "text", "required": true},
        {"name": "key_argument", "label": "Key Argument / Thesis", "type": "text", "required": true},
        {"name": "audience", "label": "Target Audience", "type": "text", "required": true}
    ]$vars$::jsonb
);

-- Newsletter — Standard (2-step: draft + review)
INSERT INTO content_prompt_sequences (contract_id, content_type_slug, name, description, is_default, sort_order, steps, variables)
VALUES (
    NULL,
    'newsletter',
    'Standard Newsletter',
    'Email newsletter issue. Draft then review for email readability and engagement.',
    true,
    1,
    $steps$[
        {
            "step_order": 1,
            "name": "draft",
            "system_prompt": "You are a newsletter writer for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. Write for email format — scannable, engaging, and concise. Use short paragraphs and clear section breaks.",
            "user_prompt": "Write a newsletter issue.\n\nTopic: {{topic}}\nKey Points to Cover: {{key_points}}\nCall to Action: {{cta}}\n\nRequirements:\n- Attention-grabbing subject line suggestion\n- Preview text suggestion (under 90 characters)\n- Brief, engaging introduction\n- 2-4 content sections with clear headings\n- Each section should be scannable (short paragraphs, bullet points where appropriate)\n- Clear CTA at the end\n\nFormat as markdown. Include subject line and preview text at the top.",
            "output_key": "draft"
        },
        {
            "step_order": 2,
            "name": "review",
            "system_prompt": "You are an email marketing specialist reviewing newsletter content for engagement, deliverability, and readability on mobile devices.",
            "user_prompt": "Review and improve this newsletter:\n\n{{step:draft}}\n\nEdit for:\n1. Subject line — test for open-rate potential (curiosity, value, urgency)\n2. Scannability — ensure readers can skim and get value\n3. Mobile readability — short paragraphs, no long unbroken text blocks\n4. CTA clarity — is it clear what the reader should do next?\n5. Tone — warm, helpful, not salesy\n\nReturn the complete improved newsletter in the same format.",
            "output_key": "final"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "topic", "label": "Topic / Theme", "type": "text", "required": true},
        {"name": "key_points", "label": "Key Points", "type": "text", "required": true},
        {"name": "cta", "label": "Call to Action", "type": "text", "required": true}
    ]$vars$::jsonb
);

-- Case Study — Standard (2-step: draft + review)
INSERT INTO content_prompt_sequences (contract_id, content_type_slug, name, description, is_default, sort_order, steps, variables)
VALUES (
    NULL,
    'case_study',
    'Standard Case Study',
    'Customer success story in challenge-solution-results format. Draft then review.',
    true,
    1,
    $steps$[
        {
            "step_order": 1,
            "name": "draft",
            "system_prompt": "You are a case study writer for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. Write compelling customer success stories that balance storytelling with concrete results.",
            "user_prompt": "Write a customer case study.\n\nCustomer: {{customer_name}}\nChallenge: {{challenge}}\nSolution: {{solution}}\nResults: {{results}}\n\nFormat:\n1. Executive summary (2-3 sentences)\n2. About the customer (brief background)\n3. The challenge (what problem they faced)\n4. The solution (how they used our product/service)\n5. The results (quantified outcomes, quotes if available)\n6. Looking ahead (what's next)\n\nUse the provided reference materials for accurate details. Write in markdown with clear headings.",
            "output_key": "draft"
        },
        {
            "step_order": 2,
            "name": "review",
            "system_prompt": "You are a senior marketing editor reviewing case study content. Focus on credibility, specificity, and persuasive storytelling.",
            "user_prompt": "Review and improve this case study:\n\n{{step:draft}}\n\nEdit for:\n1. Credibility — ensure all claims are specific and quantified where possible\n2. Storytelling — strengthen the narrative arc (challenge → solution → transformation)\n3. Persuasiveness — would this convince a prospect? Strengthen the value proposition\n4. Readability — clear structure, easy to skim\n5. Pull quotes — suggest 2-3 quotable sentences for use in marketing materials\n\nReturn the complete improved case study in the same format.",
            "output_key": "final"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "customer_name", "label": "Customer Name", "type": "text", "required": true},
        {"name": "challenge", "label": "Challenge", "type": "text", "required": true},
        {"name": "solution", "label": "Solution", "type": "text", "required": true},
        {"name": "results", "label": "Results", "type": "text", "required": true}
    ]$vars$::jsonb
);

-- Social Media — Quick Post (1-step: single shot)
INSERT INTO content_prompt_sequences (contract_id, content_type_slug, name, description, is_default, sort_order, steps, variables)
VALUES (
    NULL,
    'social_media',
    'Social Post',
    'Single-step social media content generation for LinkedIn, Twitter, or other platforms.',
    true,
    1,
    $steps$[
        {
            "step_order": 1,
            "name": "generate",
            "system_prompt": "You are a social media content creator for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. Write engaging, platform-appropriate social content.",
            "user_prompt": "Create social media content.\n\nTopic: {{topic}}\nPlatform: {{platform}}\nCall to Action: {{cta}}\n\nRequirements:\n- Write 3 variations of the post (different hooks/angles)\n- Respect platform character limits and norms\n- Include relevant hashtag suggestions\n- For LinkedIn: professional tone, longer format OK, use line breaks for readability\n- For Twitter/X: concise, punchy, under 280 characters per tweet\n- For both: suggest an image/visual concept for each variation\n\nFormat as markdown with each variation clearly labeled.",
            "output_key": "final"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "topic", "label": "Topic", "type": "text", "required": true},
        {"name": "platform", "label": "Platform", "type": "text", "required": true},
        {"name": "cta", "label": "Call to Action", "type": "text", "required": false}
    ]$vars$::jsonb
);

-- Video Script — Standard (2-step: script + review)
INSERT INTO content_prompt_sequences (contract_id, content_type_slug, name, description, is_default, sort_order, steps, variables)
VALUES (
    NULL,
    'video_script',
    'Standard Video Script',
    'Video script with speaker notes and visual cues. Draft then review for pacing and engagement.',
    true,
    1,
    $steps$[
        {
            "step_order": 1,
            "name": "draft",
            "system_prompt": "You are a video scriptwriter for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. Write scripts that are conversational, engaging, and designed for on-camera delivery.",
            "user_prompt": "Write a video script.\n\nTopic: {{topic}}\nTarget Length: {{target_length}}\nTarget Audience: {{audience}}\n\nFormat:\n- INTRO: Hook the viewer in the first 10 seconds\n- BODY: Main content in clear sections\n- OUTRO: Summary + CTA\n\nFor each section include:\n- [SPEAKER]: What the presenter says (conversational tone)\n- [VISUAL]: Suggested on-screen graphics, b-roll, or text overlays\n- [NOTE]: Any production notes\n\nWrite in markdown. Use the provided reference materials for accuracy.",
            "output_key": "draft"
        },
        {
            "step_order": 2,
            "name": "review",
            "system_prompt": "You are a video content editor reviewing scripts for pacing, engagement, and production feasibility.",
            "user_prompt": "Review and improve this video script:\n\n{{step:draft}}\n\nEdit for:\n1. Hook — does the first 10 seconds grab attention?\n2. Pacing — does it flow naturally when read aloud? Flag sections that are too dense\n3. Conversational tone — remove anything that sounds like written copy vs spoken word\n4. Visual suggestions — are the visual cues practical and enhancing?\n5. CTA — is the closing compelling?\n\nReturn the complete improved script in the same format.",
            "output_key": "final"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "topic", "label": "Topic", "type": "text", "required": true},
        {"name": "target_length", "label": "Target Length (e.g. 3-5 minutes)", "type": "text", "required": true},
        {"name": "audience", "label": "Target Audience", "type": "text", "required": true}
    ]$vars$::jsonb
);
