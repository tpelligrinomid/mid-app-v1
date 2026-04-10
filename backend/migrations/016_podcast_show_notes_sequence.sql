-- Migration 016: Podcast Show Notes + Social Posts prompt sequence
-- Adds global content type and default 2-step prompt sequence
-- Run in Supabase SQL Editor

-- ============================================================================
-- Add podcast_show_notes content type (global default, NULL contract_id)
-- ============================================================================

INSERT INTO content_types (contract_id, name, slug, description, sort_order)
VALUES (NULL, 'Podcast Show Notes', 'podcast_show_notes', 'Show notes, key insights, episode highlights, quotes, and social media posts generated from a podcast episode transcript.', 10)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Seed global default prompt sequence for podcast_show_notes
-- ============================================================================

INSERT INTO content_prompt_sequences (contract_id, content_type_slug, name, description, is_default, sort_order, steps, variables)
VALUES (
    NULL,
    'podcast_show_notes',
    'Podcast Show Notes + Social Posts',
    'Two-step pipeline: generate comprehensive show notes from episode transcript, then create social media posts for each video clip asset.',
    true,
    1,
    $steps$[
        {
            "step_order": 1,
            "name": "show_notes",
            "system_prompt": "You are an expert podcast content strategist and writer. You produce detailed, high-quality show notes that serve as both a standalone content piece and an SEO-optimized companion to the episode.\n\nAbout this podcast:\n{{creative_brief}}\n\nYou write in a professional but conversational tone — authoritative without being stiff, insightful without being academic. Your show notes should make someone who hasn't listened feel like they understand the core value of the episode, while giving listeners a reference they'll want to bookmark.\n\nGuidelines:\n- Pull direct quotes from the transcript with approximate timestamps (format: ~HH:MM:SS or ~MM:SS)\n- Identify the most substantive insights — not surface-level takeaways, but the ideas that would make an executive stop and think\n- Episode highlights should each tie to a specific moment in the conversation with a timestamp\n- Key insights should be expanded into 4-6 sentence paragraphs that contextualize why the insight matters to the target audience\n- Title options should be varied in tone: one direct/descriptive, one provocative/curiosity-driven, one quote-based, one SEO-friendly\n- Top quotes should be the most memorable, shareable lines — not just any quote. Include speaker name and approximate timestamp\n- Write the episode summary in third person, 2-3 paragraphs, conveying the arc of the conversation",
            "user_prompt": "Generate complete podcast show notes for this episode using the following structure. Follow the format precisely.\n\n**Host:** {{host_name}}, {{host_title}} at {{host_company}}\n**Guest(s):** {{guest_info}}\n\n{{additional_comments}}\n\n## FULL EPISODE TRANSCRIPT\n\n{{transcript}}\n\n---\n\nProduce the show notes in this exact structure:\n\n## Title Options\n- Provide exactly 4 title options (bulleted list)\n\n## Episode Summary\n- 2-3 paragraphs, third person, covering the arc of the conversation\n\n## Guest-at-a-Glance\n- Name, role, company, noteworthy accomplishments/context, where to find them\n- If multiple guests, create a separate block for each\n\n## Key Insights\n- 3-4 major insights, each with a bold heading and a 4-6 sentence paragraph\n- These should be the ideas that matter most to the target audience\n- Contextualize why each insight matters — don't just summarize, interpret\n\n## Episode Highlights\n- 4-5 specific moments from the conversation\n- Each with a bold heading, approximate timestamp, a paragraph explaining the moment and its significance, and a pull quote from that section\n\n## Top Quotes\n- 6-10 of the most memorable, shareable quotes\n- Format: **Speaker Name [~timestamp]** followed by the quote in quotation marks\n- Mix of guest and host quotes, weighted toward the guest",
            "output_key": "show_notes"
        },
        {
            "step_order": 2,
            "name": "social_posts",
            "system_prompt": "You are a social media strategist specializing in B2B content promotion. You create scroll-stopping LinkedIn posts that drive engagement and views for podcast video clips.\n\nAbout this podcast:\n{{creative_brief}}\n\nGuidelines:\n- Each post should be tailored to the specific video clip's content and quote\n- Write for LinkedIn as the primary platform — professional but human, no hashtag spam\n- Open with a hook that stops the scroll — a bold statement, a contrarian take, or a relatable observation\n- Keep posts to 150-250 words (LinkedIn sweet spot for engagement)\n- End each post with a soft CTA that drives to the episode or invites conversation\n- Reference the guest by name and tag-friendly handle/title where relevant\n- Don't use generic podcast promotion language (\"Check out our latest episode!\") — lead with the idea, not the format\n- Include 2-3 relevant hashtags at the end, max",
            "user_prompt": "Using the show notes below for context, generate one LinkedIn social media post for each video asset in the manifest.\n\n## SHOW NOTES (for context)\n\n{{step:show_notes}}\n\n---\n\n## ASSET MANIFEST\n\nEach entry below is a short video clip from the episode with its filename and the corresponding quote or transcript excerpt.\n\n{{asset_manifest}}\n\n---\n\nFor each asset in the manifest, produce:\n\n### [Asset Filename]\n**Clip Context:** 1 sentence describing what this clip captures\n**LinkedIn Post:** The full post copy (150-250 words)\n\nMake each post unique — vary the hooks, angles, and CTAs. Don't be repetitive across posts. The posts should work as a series but each should stand completely on its own.",
            "output_key": "social_posts"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "transcript", "label": "Episode Transcript", "type": "textarea", "required": true},
        {"name": "creative_brief", "label": "Creative Brief (audience, intent, format)", "type": "textarea", "required": true},
        {"name": "host_name", "label": "Host Name", "type": "text", "required": true},
        {"name": "host_title", "label": "Host Title", "type": "text", "required": true},
        {"name": "host_company", "label": "Host Company", "type": "text", "required": true},
        {"name": "guest_info", "label": "Guest(s) — name, title, company (one per line if multiple)", "type": "textarea", "required": true},
        {"name": "asset_manifest", "label": "Asset Manifest — filename and quote/transcript per clip", "type": "textarea", "required": true},
        {"name": "additional_comments", "label": "Additional Comments (optional)", "type": "textarea", "required": false}
    ]$vars$::jsonb
);
