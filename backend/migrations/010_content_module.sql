-- Migration 010: Content Module (Phase 1)
-- Tables: content_types, content_categories, content_attribute_definitions, content_ideas, content_assets
-- Run in Supabase SQL Editor

-- ============================================================================
-- content_types — What kind of content (blog, newsletter, video, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_types (
    type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),  -- NULL = global default
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, slug)
);

-- ============================================================================
-- content_categories — Organizational grouping (client-specific taxonomy)
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_categories (
    category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),  -- NULL = global default
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    color text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, slug)
);

-- ============================================================================
-- content_attribute_definitions — Custom metadata fields per contract
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_attribute_definitions (
    attribute_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    name text NOT NULL,
    slug text NOT NULL,
    field_type text NOT NULL,  -- 'single_select' | 'multi_select' | 'boolean' | 'text'
    options jsonb,
    is_required boolean DEFAULT false,
    applies_to text DEFAULT 'both',  -- 'ideas' | 'assets' | 'both'
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, slug)
);

-- ============================================================================
-- content_ideas — Lightweight ideation items
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_ideas (
    idea_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    title text NOT NULL,
    description text,
    content_type_id uuid REFERENCES content_types(type_id),
    category_id uuid REFERENCES content_categories(category_id),
    source text DEFAULT 'manual',
    status text DEFAULT 'idea',
    priority integer,
    target_date date,
    custom_attributes jsonb,
    tags text[],
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- content_assets — Full content items in production/published
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_assets (
    asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    idea_id uuid REFERENCES content_ideas(idea_id),
    title text NOT NULL,
    description text,
    content_type_id uuid REFERENCES content_types(type_id),
    category_id uuid REFERENCES content_categories(category_id),
    content_body text,
    content_structured jsonb,
    status text DEFAULT 'draft',
    file_path text,
    file_name text,
    file_size_bytes bigint,
    mime_type text,
    external_url text,
    clickup_task_id text,
    tags text[],
    custom_attributes jsonb,
    published_date date,
    metadata jsonb,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_content_types_contract ON content_types(contract_id);
CREATE INDEX IF NOT EXISTS idx_content_categories_contract ON content_categories(contract_id);
CREATE INDEX IF NOT EXISTS idx_content_attr_defs_contract ON content_attribute_definitions(contract_id);
CREATE INDEX IF NOT EXISTS idx_content_ideas_contract ON content_ideas(contract_id);
CREATE INDEX IF NOT EXISTS idx_content_ideas_status ON content_ideas(status);
CREATE INDEX IF NOT EXISTS idx_content_ideas_target_date ON content_ideas(target_date);
CREATE INDEX IF NOT EXISTS idx_content_assets_contract ON content_assets(contract_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_status ON content_assets(status);
CREATE INDEX IF NOT EXISTS idx_content_assets_idea ON content_assets(idea_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_published ON content_assets(published_date);

-- ============================================================================
-- Seed global default content types (contract_id = NULL)
-- ============================================================================

INSERT INTO content_types (contract_id, name, slug, description, sort_order) VALUES
    (NULL, 'Blog Post',        'blog_post',       'Long-form blog article',                    1),
    (NULL, 'Newsletter',       'newsletter',      'Email newsletter issue',                    2),
    (NULL, 'Social Media',     'social_media',    'Social media post or campaign',             3),
    (NULL, 'Video Script',     'video_script',    'Script for video content',                  4),
    (NULL, 'Podcast Episode',  'podcast_episode', 'Podcast episode script or outline',         5),
    (NULL, 'Case Study',       'case_study',      'Customer success case study',               6),
    (NULL, 'Whitepaper',       'whitepaper',      'In-depth industry whitepaper',              7),
    (NULL, 'Ebook',            'ebook',           'Downloadable ebook or guide',               8),
    (NULL, 'Infographic',      'infographic',     'Visual infographic content',                9),
    (NULL, 'Webinar',          'webinar',         'Webinar presentation or script',           10)
ON CONFLICT (contract_id, slug) DO NOTHING;

-- ============================================================================
-- Seed global default content categories (contract_id = NULL)
-- ============================================================================

INSERT INTO content_categories (contract_id, name, slug, description, sort_order) VALUES
    (NULL, 'Thought Leadership', 'thought_leadership', 'Expert opinions and industry insights',     1),
    (NULL, 'Product Marketing',  'product_marketing',  'Product features, launches, and updates',   2),
    (NULL, 'Customer Stories',   'customer_stories',   'Case studies and testimonials',              3),
    (NULL, 'Industry News',      'industry_news',      'Industry trends and news commentary',       4),
    (NULL, 'How-To',             'how_to',             'Tutorials and instructional content',        5),
    (NULL, 'Company Culture',    'company_culture',    'Brand culture and team stories',             6)
ON CONFLICT (contract_id, slug) DO NOTHING;
