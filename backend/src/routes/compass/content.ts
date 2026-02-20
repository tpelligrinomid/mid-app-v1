import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { select, insert, del } from '../../utils/edge-functions.js';
import { ingestContent } from '../../services/rag/ingestion.js';
import {
  CreateContentTypeDTO,
  UpdateContentTypeDTO,
  CreateContentCategoryDTO,
  UpdateContentCategoryDTO,
  CreateAttributeDefinitionDTO,
  UpdateAttributeDefinitionDTO,
  CreateContentIdeaDTO,
  UpdateContentIdeaDTO,
  CreateContentAssetDTO,
  UpdateContentAssetDTO,
  ContentType,
  ContentCategory,
  ContentAttributeDefinition,
  ContentIdea,
  ContentAsset,
  isValidContentIdeaStatus,
  isValidContentAssetStatus,
  CONTENT_IDEA_STATUS_VALUES,
  CONTENT_ASSET_STATUS_VALUES,
  validateContentIdeaInput,
  validateContentAssetInput,
  validateAttributeDefinitionInput,
} from '../../types/content.js';

const router = Router();

// ============================================================================
// CONFIG ENDPOINTS
// ============================================================================

/**
 * GET /api/compass/content/config
 * Get full content config for a contract (types, categories, attributes)
 */
router.get(
  '/config',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id } = req.query;
    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    try {
      // Fetch contract-specific + global types
      const { data: types } = await req.supabase
        .from('content_types')
        .select('*')
        .or(`contract_id.eq.${contract_id},contract_id.is.null`)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      // Fetch contract-specific + global categories
      const { data: categories } = await req.supabase
        .from('content_categories')
        .select('*')
        .or(`contract_id.eq.${contract_id},contract_id.is.null`)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      // Fetch contract-specific attribute definitions
      const { data: attributes } = await req.supabase
        .from('content_attribute_definitions')
        .select('*')
        .eq('contract_id', contract_id)
        .order('sort_order', { ascending: true });

      res.json({
        types: types || [],
        categories: categories || [],
        attributes: attributes || [],
      });
    } catch (err) {
      console.error('Error fetching content config:', err);
      res.status(500).json({ error: 'Failed to fetch content config' });
    }
  }
);

/**
 * POST /api/compass/content/config/initialize
 * Clone global default types and categories into contract-specific rows
 */
router.post(
  '/config/initialize',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id } = req.query;
    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    // Verify contract exists
    const { data: contract, error: contractError } = await req.supabase
      .from('contracts')
      .select('contract_id')
      .eq('contract_id', contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    try {
      // Check if already initialized (contract has its own types)
      const { data: existingTypes } = await req.supabase
        .from('content_types')
        .select('type_id')
        .eq('contract_id', contract_id)
        .limit(1);

      if (existingTypes && existingTypes.length > 0) {
        res.status(400).json({ error: 'Content config already initialized for this contract' });
        return;
      }

      // Fetch global default types
      const { data: globalTypes } = await req.supabase
        .from('content_types')
        .select('name, slug, description, icon, sort_order')
        .is('contract_id', null)
        .eq('is_active', true);

      // Fetch global default categories
      const { data: globalCategories } = await req.supabase
        .from('content_categories')
        .select('name, slug, description, color, sort_order')
        .is('contract_id', null)
        .eq('is_active', true);

      // Clone types for contract
      if (globalTypes && globalTypes.length > 0) {
        const contractTypes = globalTypes.map((t) => ({
          ...t,
          contract_id,
        }));
        await req.supabase.from('content_types').insert(contractTypes);
      }

      // Clone categories for contract
      if (globalCategories && globalCategories.length > 0) {
        const contractCategories = globalCategories.map((c) => ({
          ...c,
          contract_id,
        }));
        await req.supabase.from('content_categories').insert(contractCategories);
      }

      res.status(201).json({
        message: 'Content config initialized',
        types_created: globalTypes?.length || 0,
        categories_created: globalCategories?.length || 0,
      });
    } catch (err) {
      console.error('Error initializing content config:', err);
      res.status(500).json({ error: 'Failed to initialize content config' });
    }
  }
);

// ============================================================================
// CONTENT TYPES CRUD
// ============================================================================

/**
 * GET /api/compass/content/types
 * List content types (contract-specific + global defaults)
 */
router.get(
  '/types',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id } = req.query;
    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    const { data: types, error } = await req.supabase
      .from('content_types')
      .select('*')
      .or(`contract_id.eq.${contract_id},contract_id.is.null`)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching content types:', error);
      res.status(500).json({ error: 'Failed to fetch content types' });
      return;
    }

    res.json({ types: types || [] });
  }
);

/**
 * POST /api/compass/content/types
 * Create a content type for a contract
 */
router.post(
  '/types',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const input: CreateContentTypeDTO = req.body;

    if (!input.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }
    if (!input.name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!input.slug) {
      res.status(400).json({ error: 'slug is required' });
      return;
    }

    const { data: contentType, error } = await req.supabase
      .from('content_types')
      .insert({
        contract_id: input.contract_id,
        name: input.name,
        slug: input.slug,
        description: input.description || null,
        icon: input.icon || null,
        is_active: input.is_active !== undefined ? input.is_active : true,
        sort_order: input.sort_order || 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A content type with this slug already exists for this contract' });
        return;
      }
      console.error('Error creating content type:', error);
      res.status(500).json({ error: 'Failed to create content type' });
      return;
    }

    res.status(201).json({ type: contentType });
  }
);

/**
 * PUT /api/compass/content/types/:id
 * Update a content type
 */
router.put(
  '/types/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const updates: UpdateContentTypeDTO = req.body;

    const updateFields: Record<string, unknown> = {};
    if (updates.name !== undefined) updateFields.name = updates.name;
    if (updates.slug !== undefined) updateFields.slug = updates.slug;
    if (updates.description !== undefined) updateFields.description = updates.description;
    if (updates.icon !== undefined) updateFields.icon = updates.icon;
    if (updates.is_active !== undefined) updateFields.is_active = updates.is_active;
    if (updates.sort_order !== undefined) updateFields.sort_order = updates.sort_order;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data: contentType, error } = await req.supabase
      .from('content_types')
      .update(updateFields)
      .eq('type_id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Content type not found' });
        return;
      }
      console.error('Error updating content type:', error);
      res.status(500).json({ error: 'Failed to update content type' });
      return;
    }

    res.json({ type: contentType });
  }
);

/**
 * DELETE /api/compass/content/types/:id
 * Deactivate a content type (soft delete)
 */
router.delete(
  '/types/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    const { error } = await req.supabase
      .from('content_types')
      .update({ is_active: false })
      .eq('type_id', id);

    if (error) {
      console.error('Error deactivating content type:', error);
      res.status(500).json({ error: 'Failed to deactivate content type' });
      return;
    }

    res.status(204).send();
  }
);

// ============================================================================
// CONTENT CATEGORIES CRUD
// ============================================================================

/**
 * GET /api/compass/content/categories
 * List categories (contract-specific + global defaults)
 */
router.get(
  '/categories',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id } = req.query;
    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    const { data: categories, error } = await req.supabase
      .from('content_categories')
      .select('*')
      .or(`contract_id.eq.${contract_id},contract_id.is.null`)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({ error: 'Failed to fetch categories' });
      return;
    }

    res.json({ categories: categories || [] });
  }
);

/**
 * POST /api/compass/content/categories
 * Create a content category for a contract
 */
router.post(
  '/categories',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const input: CreateContentCategoryDTO = req.body;

    if (!input.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }
    if (!input.name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!input.slug) {
      res.status(400).json({ error: 'slug is required' });
      return;
    }

    const { data: category, error } = await req.supabase
      .from('content_categories')
      .insert({
        contract_id: input.contract_id,
        name: input.name,
        slug: input.slug,
        description: input.description || null,
        color: input.color || null,
        is_active: input.is_active !== undefined ? input.is_active : true,
        sort_order: input.sort_order || 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A category with this slug already exists for this contract' });
        return;
      }
      console.error('Error creating category:', error);
      res.status(500).json({ error: 'Failed to create category' });
      return;
    }

    res.status(201).json({ category });
  }
);

/**
 * PUT /api/compass/content/categories/:id
 * Update a content category
 */
router.put(
  '/categories/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const updates: UpdateContentCategoryDTO = req.body;

    const updateFields: Record<string, unknown> = {};
    if (updates.name !== undefined) updateFields.name = updates.name;
    if (updates.slug !== undefined) updateFields.slug = updates.slug;
    if (updates.description !== undefined) updateFields.description = updates.description;
    if (updates.color !== undefined) updateFields.color = updates.color;
    if (updates.is_active !== undefined) updateFields.is_active = updates.is_active;
    if (updates.sort_order !== undefined) updateFields.sort_order = updates.sort_order;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data: category, error } = await req.supabase
      .from('content_categories')
      .update(updateFields)
      .eq('category_id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Category not found' });
        return;
      }
      console.error('Error updating category:', error);
      res.status(500).json({ error: 'Failed to update category' });
      return;
    }

    res.json({ category });
  }
);

/**
 * DELETE /api/compass/content/categories/:id
 * Deactivate a category (soft delete)
 */
router.delete(
  '/categories/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    const { error } = await req.supabase
      .from('content_categories')
      .update({ is_active: false })
      .eq('category_id', id);

    if (error) {
      console.error('Error deactivating category:', error);
      res.status(500).json({ error: 'Failed to deactivate category' });
      return;
    }

    res.status(204).send();
  }
);

// ============================================================================
// ATTRIBUTE DEFINITIONS CRUD
// ============================================================================

/**
 * GET /api/compass/content/attributes
 * List custom attribute definitions for a contract
 */
router.get(
  '/attributes',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id } = req.query;
    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    const { data: attributes, error } = await req.supabase
      .from('content_attribute_definitions')
      .select('*')
      .eq('contract_id', contract_id)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching attributes:', error);
      res.status(500).json({ error: 'Failed to fetch attribute definitions' });
      return;
    }

    res.json({ attributes: attributes || [] });
  }
);

/**
 * POST /api/compass/content/attributes
 * Create a custom attribute definition
 */
router.post(
  '/attributes',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const input: CreateAttributeDefinitionDTO = req.body;

    if (!input.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }
    if (!input.name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!input.slug) {
      res.status(400).json({ error: 'slug is required' });
      return;
    }
    if (!input.field_type) {
      res.status(400).json({ error: 'field_type is required' });
      return;
    }

    const validationErrors = validateAttributeDefinitionInput(input);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    const { data: attribute, error } = await req.supabase
      .from('content_attribute_definitions')
      .insert({
        contract_id: input.contract_id,
        name: input.name,
        slug: input.slug,
        field_type: input.field_type,
        options: input.options || null,
        is_required: input.is_required || false,
        applies_to: input.applies_to || 'both',
        sort_order: input.sort_order || 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'An attribute with this slug already exists for this contract' });
        return;
      }
      console.error('Error creating attribute:', error);
      res.status(500).json({ error: 'Failed to create attribute definition' });
      return;
    }

    res.status(201).json({ attribute });
  }
);

/**
 * PUT /api/compass/content/attributes/:id
 * Update an attribute definition
 */
router.put(
  '/attributes/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const updates: UpdateAttributeDefinitionDTO = req.body;

    const validationErrors = validateAttributeDefinitionInput(updates);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (updates.name !== undefined) updateFields.name = updates.name;
    if (updates.slug !== undefined) updateFields.slug = updates.slug;
    if (updates.field_type !== undefined) updateFields.field_type = updates.field_type;
    if (updates.options !== undefined) updateFields.options = updates.options;
    if (updates.is_required !== undefined) updateFields.is_required = updates.is_required;
    if (updates.applies_to !== undefined) updateFields.applies_to = updates.applies_to;
    if (updates.sort_order !== undefined) updateFields.sort_order = updates.sort_order;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data: attribute, error } = await req.supabase
      .from('content_attribute_definitions')
      .update(updateFields)
      .eq('attribute_id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Attribute definition not found' });
        return;
      }
      console.error('Error updating attribute:', error);
      res.status(500).json({ error: 'Failed to update attribute definition' });
      return;
    }

    res.json({ attribute });
  }
);

/**
 * DELETE /api/compass/content/attributes/:id
 * Delete an attribute definition
 */
router.delete(
  '/attributes/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    const { error } = await req.supabase
      .from('content_attribute_definitions')
      .delete()
      .eq('attribute_id', id);

    if (error) {
      console.error('Error deleting attribute:', error);
      res.status(500).json({ error: 'Failed to delete attribute definition' });
      return;
    }

    res.status(204).send();
  }
);

// ============================================================================
// IDEAS CRUD
// ============================================================================

/**
 * GET /api/compass/content/ideas
 * List ideas with filters
 */
router.get('/ideas', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { contract_id, status, category_id, content_type_id, limit, offset } = req.query;

  if (!contract_id || typeof contract_id !== 'string') {
    res.status(400).json({ error: 'contract_id query parameter is required' });
    return;
  }

  if (status && !isValidContentIdeaStatus(status as string)) {
    res.status(400).json({
      error: `Invalid status. Valid values: ${CONTENT_IDEA_STATUS_VALUES.join(', ')}`,
    });
    return;
  }

  // For clients, verify access
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', contract_id)
      .single();

    if (!access) {
      res.status(403).json({ error: 'Access denied to this contract', code: 'CONTRACT_ACCESS_DENIED' });
      return;
    }
  }

  let query = req.supabase
    .from('content_ideas')
    .select(`
      idea_id,
      contract_id,
      title,
      description,
      content_type_id,
      category_id,
      source,
      status,
      priority,
      target_date,
      custom_attributes,
      tags,
      created_by,
      created_at,
      updated_at
    `)
    .eq('contract_id', contract_id)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status as string);
  }
  if (category_id) {
    query = query.eq('category_id', category_id as string);
  }
  if (content_type_id) {
    query = query.eq('content_type_id', content_type_id as string);
  }

  const limitNum = parseInt(limit as string) || 50;
  const offsetNum = parseInt(offset as string) || 0;
  query = query.range(offsetNum, offsetNum + limitNum - 1);

  const { data: ideas, error } = await query;

  if (error) {
    console.error('Error fetching ideas:', error);
    res.status(500).json({ error: 'Failed to fetch ideas' });
    return;
  }

  res.json({ ideas: ideas || [] });
});

/**
 * GET /api/compass/content/ideas/:id
 * Get a single idea
 */
router.get('/ideas/:id', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { id } = req.params;

  const { data: idea, error } = await req.supabase
    .from('content_ideas')
    .select('*')
    .eq('idea_id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Idea not found' });
      return;
    }
    console.error('Error fetching idea:', error);
    res.status(500).json({ error: 'Failed to fetch idea' });
    return;
  }

  // For clients, verify access
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', idea.contract_id)
      .single();

    if (!access) {
      res.status(403).json({ error: 'Access denied to this contract', code: 'CONTRACT_ACCESS_DENIED' });
      return;
    }
  }

  res.json({ idea });
});

/**
 * POST /api/compass/content/ideas
 * Create a new idea
 */
router.post(
  '/ideas',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const input: CreateContentIdeaDTO = req.body;

    if (!input.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }
    if (!input.title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const validationErrors = validateContentIdeaInput(input);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Verify contract exists
    const { data: contract, error: contractError } = await req.supabase
      .from('contracts')
      .select('contract_id')
      .eq('contract_id', input.contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    const { data: idea, error } = await req.supabase
      .from('content_ideas')
      .insert({
        contract_id: input.contract_id,
        title: input.title,
        description: input.description || null,
        content_type_id: input.content_type_id || null,
        category_id: input.category_id || null,
        source: input.source || 'manual',
        status: input.status || 'idea',
        priority: input.priority || null,
        target_date: input.target_date || null,
        custom_attributes: input.custom_attributes || null,
        tags: input.tags || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating idea:', error);
      res.status(500).json({ error: 'Failed to create idea' });
      return;
    }

    res.status(201).json({ idea });
  }
);

/**
 * PUT /api/compass/content/ideas/:id
 * Update an idea
 */
router.put(
  '/ideas/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const updates: UpdateContentIdeaDTO = req.body;

    const validationErrors = validateContentIdeaInput(updates);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Check if idea exists
    const { data: existing, error: fetchError } = await req.supabase
      .from('content_ideas')
      .select('idea_id')
      .eq('idea_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }
      console.error('Error fetching idea:', fetchError);
      res.status(500).json({ error: 'Failed to fetch idea' });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (updates.title !== undefined) updateFields.title = updates.title;
    if (updates.description !== undefined) updateFields.description = updates.description;
    if (updates.content_type_id !== undefined) updateFields.content_type_id = updates.content_type_id;
    if (updates.category_id !== undefined) updateFields.category_id = updates.category_id;
    if (updates.source !== undefined) updateFields.source = updates.source;
    if (updates.status !== undefined) updateFields.status = updates.status;
    if (updates.priority !== undefined) updateFields.priority = updates.priority;
    if (updates.target_date !== undefined) updateFields.target_date = updates.target_date;
    if (updates.custom_attributes !== undefined) updateFields.custom_attributes = updates.custom_attributes;
    if (updates.tags !== undefined) updateFields.tags = updates.tags;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data: idea, error } = await req.supabase
      .from('content_ideas')
      .update(updateFields)
      .eq('idea_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating idea:', error);
      res.status(500).json({ error: 'Failed to update idea' });
      return;
    }

    res.json({ idea });
  }
);

/**
 * DELETE /api/compass/content/ideas/:id
 * Delete an idea
 */
router.delete(
  '/ideas/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    const { data: existing, error: fetchError } = await req.supabase
      .from('content_ideas')
      .select('idea_id')
      .eq('idea_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }
      console.error('Error fetching idea:', fetchError);
      res.status(500).json({ error: 'Failed to fetch idea' });
      return;
    }

    const { error } = await req.supabase
      .from('content_ideas')
      .delete()
      .eq('idea_id', id);

    if (error) {
      console.error('Error deleting idea:', error);
      res.status(500).json({ error: 'Failed to delete idea' });
      return;
    }

    res.status(204).send();
  }
);

/**
 * POST /api/compass/content/ideas/:id/promote
 * Promote an approved idea to a content asset
 */
router.post(
  '/ideas/:id/promote',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    // Fetch the idea
    const { data: idea, error: ideaError } = await req.supabase
      .from('content_ideas')
      .select('*')
      .eq('idea_id', id)
      .single();

    if (ideaError) {
      if (ideaError.code === 'PGRST116') {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }
      console.error('Error fetching idea:', ideaError);
      res.status(500).json({ error: 'Failed to fetch idea' });
      return;
    }

    if (idea.status !== 'approved') {
      res.status(400).json({
        error: 'Only approved ideas can be promoted. Current status: ' + idea.status,
      });
      return;
    }

    // Check if already promoted (asset with this idea_id exists)
    const { data: existingAsset } = await req.supabase
      .from('content_assets')
      .select('asset_id')
      .eq('idea_id', id)
      .limit(1);

    if (existingAsset && existingAsset.length > 0) {
      res.status(409).json({
        error: 'This idea has already been promoted to an asset',
        asset_id: existingAsset[0].asset_id,
      });
      return;
    }

    // Create the asset from the idea
    const { data: asset, error: assetError } = await req.supabase
      .from('content_assets')
      .insert({
        contract_id: idea.contract_id,
        idea_id: idea.idea_id,
        title: idea.title,
        description: idea.description,
        content_type_id: idea.content_type_id,
        category_id: idea.category_id,
        status: 'draft',
        custom_attributes: idea.custom_attributes,
        tags: idea.tags,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (assetError) {
      console.error('Error creating asset from idea:', assetError);
      res.status(500).json({ error: 'Failed to promote idea to asset' });
      return;
    }

    res.status(201).json({ asset, idea_id: idea.idea_id });
  }
);

// ============================================================================
// ASSETS CRUD
// ============================================================================

/**
 * GET /api/compass/content/assets
 * List assets with filters
 */
router.get('/assets', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { contract_id, status, content_type_id, category_id, limit, offset } = req.query;

  if (!contract_id || typeof contract_id !== 'string') {
    res.status(400).json({ error: 'contract_id query parameter is required' });
    return;
  }

  if (status && !isValidContentAssetStatus(status as string)) {
    res.status(400).json({
      error: `Invalid status. Valid values: ${CONTENT_ASSET_STATUS_VALUES.join(', ')}`,
    });
    return;
  }

  // For clients, verify access
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', contract_id)
      .single();

    if (!access) {
      res.status(403).json({ error: 'Access denied to this contract', code: 'CONTRACT_ACCESS_DENIED' });
      return;
    }
  }

  let query = req.supabase
    .from('content_assets')
    .select(`
      asset_id,
      contract_id,
      idea_id,
      title,
      description,
      content_type_id,
      category_id,
      status,
      file_name,
      mime_type,
      external_url,
      clickup_task_id,
      tags,
      custom_attributes,
      published_date,
      metadata,
      created_by,
      created_at,
      updated_at
    `)
    .eq('contract_id', contract_id)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status as string);
  }
  if (content_type_id) {
    query = query.eq('content_type_id', content_type_id as string);
  }
  if (category_id) {
    query = query.eq('category_id', category_id as string);
  }

  const limitNum = parseInt(limit as string) || 50;
  const offsetNum = parseInt(offset as string) || 0;
  query = query.range(offsetNum, offsetNum + limitNum - 1);

  const { data: assets, error } = await query;

  if (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ error: 'Failed to fetch assets' });
    return;
  }

  res.json({ assets: assets || [] });
});

/**
 * GET /api/compass/content/assets/:id
 * Get a single asset with full content
 */
router.get('/assets/:id', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { id } = req.params;

  const { data: asset, error } = await req.supabase
    .from('content_assets')
    .select('*')
    .eq('asset_id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    console.error('Error fetching asset:', error);
    res.status(500).json({ error: 'Failed to fetch asset' });
    return;
  }

  // For clients, verify access
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', asset.contract_id)
      .single();

    if (!access) {
      res.status(403).json({ error: 'Access denied to this contract', code: 'CONTRACT_ACCESS_DENIED' });
      return;
    }
  }

  res.json({ asset });
});

/**
 * POST /api/compass/content/assets
 * Create an asset directly (without promoting from idea)
 */
router.post(
  '/assets',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const input: CreateContentAssetDTO = req.body;

    if (!input.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }
    if (!input.title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const validationErrors = validateContentAssetInput(input);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Verify contract exists
    const { data: contract, error: contractError } = await req.supabase
      .from('contracts')
      .select('contract_id')
      .eq('contract_id', input.contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    const { data: asset, error } = await req.supabase
      .from('content_assets')
      .insert({
        contract_id: input.contract_id,
        title: input.title,
        idea_id: input.idea_id || null,
        description: input.description || null,
        content_type_id: input.content_type_id || null,
        category_id: input.category_id || null,
        content_body: input.content_body || null,
        content_structured: input.content_structured || null,
        status: input.status || 'draft',
        file_path: input.file_path || null,
        file_name: input.file_name || null,
        file_size_bytes: input.file_size_bytes || null,
        mime_type: input.mime_type || null,
        external_url: input.external_url || null,
        clickup_task_id: input.clickup_task_id || null,
        tags: input.tags || null,
        custom_attributes: input.custom_attributes || null,
        published_date: input.published_date || null,
        metadata: input.metadata || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating asset:', error);
      res.status(500).json({ error: 'Failed to create asset' });
      return;
    }

    // If created directly as published, auto-ingest into knowledge base
    if (asset.status === 'published') {
      const contentToEmbed = asset.content_body ||
        (asset.content_structured ? JSON.stringify(asset.content_structured) : null);
      if (contentToEmbed && process.env.OPENAI_API_KEY) {
        try {
          await ingestContent({
            contract_id: asset.contract_id,
            source_type: 'content',
            source_id: asset.asset_id,
            title: asset.title,
            content: contentToEmbed,
          });
        } catch (embedErr) {
          console.error('[Content] Publish-embed failed (non-blocking):', embedErr);
        }
      }
    }

    res.status(201).json({ asset });
  }
);

/**
 * PUT /api/compass/content/assets/:id
 * Update an asset
 */
router.put(
  '/assets/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const updates: UpdateContentAssetDTO = req.body;

    const validationErrors = validateContentAssetInput(updates);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Fetch existing asset (need previous status to detect publish transition)
    const { data: existing, error: fetchError } = await req.supabase
      .from('content_assets')
      .select('asset_id, status')
      .eq('asset_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      console.error('Error fetching asset:', fetchError);
      res.status(500).json({ error: 'Failed to fetch asset' });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (updates.title !== undefined) updateFields.title = updates.title;
    if (updates.description !== undefined) updateFields.description = updates.description;
    if (updates.content_type_id !== undefined) updateFields.content_type_id = updates.content_type_id;
    if (updates.category_id !== undefined) updateFields.category_id = updates.category_id;
    if (updates.content_body !== undefined) updateFields.content_body = updates.content_body;
    if (updates.content_structured !== undefined) updateFields.content_structured = updates.content_structured;
    if (updates.status !== undefined) updateFields.status = updates.status;
    if (updates.file_path !== undefined) updateFields.file_path = updates.file_path;
    if (updates.file_name !== undefined) updateFields.file_name = updates.file_name;
    if (updates.file_size_bytes !== undefined) updateFields.file_size_bytes = updates.file_size_bytes;
    if (updates.mime_type !== undefined) updateFields.mime_type = updates.mime_type;
    if (updates.external_url !== undefined) updateFields.external_url = updates.external_url;
    if (updates.clickup_task_id !== undefined) updateFields.clickup_task_id = updates.clickup_task_id;
    if (updates.tags !== undefined) updateFields.tags = updates.tags;
    if (updates.custom_attributes !== undefined) updateFields.custom_attributes = updates.custom_attributes;
    if (updates.published_date !== undefined) updateFields.published_date = updates.published_date;
    if (updates.metadata !== undefined) updateFields.metadata = updates.metadata;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data: asset, error } = await req.supabase
      .from('content_assets')
      .update(updateFields)
      .eq('asset_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating asset:', error);
      res.status(500).json({ error: 'Failed to update asset' });
      return;
    }

    // Auto-ingest when status transitions to "published"
    const justPublished = updates.status === 'published' && existing.status !== 'published';
    if (justPublished && process.env.OPENAI_API_KEY) {
      const contentToEmbed = asset.content_body ||
        (asset.content_structured ? JSON.stringify(asset.content_structured) : null);
      if (contentToEmbed) {
        try {
          await ingestContent({
            contract_id: asset.contract_id,
            source_type: 'content',
            source_id: asset.asset_id,
            title: asset.title,
            content: contentToEmbed,
          });
          console.log(`[Content] Auto-ingested asset "${asset.title}" on publish`);
        } catch (embedErr) {
          console.error('[Content] Publish-embed failed (non-blocking):', embedErr);
        }
      }
    }

    res.json({ asset });
  }
);

/**
 * DELETE /api/compass/content/assets/:id
 * Delete an asset and cleanup embeddings
 */
router.delete(
  '/assets/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    const { data: existing, error: fetchError } = await req.supabase
      .from('content_assets')
      .select('asset_id')
      .eq('asset_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      console.error('Error fetching asset:', fetchError);
      res.status(500).json({ error: 'Failed to fetch asset' });
      return;
    }

    // Delete knowledge chunks
    try {
      await del('compass_knowledge', { source_id: id });
    } catch (chunkErr) {
      console.warn('[Content] Knowledge chunk cleanup warning:', chunkErr);
    }

    // Delete the asset
    const { error } = await req.supabase
      .from('content_assets')
      .delete()
      .eq('asset_id', id);

    if (error) {
      console.error('Error deleting asset:', error);
      res.status(500).json({ error: 'Failed to delete asset' });
      return;
    }

    res.status(204).send();
  }
);

/**
 * POST /api/compass/content/assets/:id/ingest
 * Process asset content: extract text, AI auto-tag, create embeddings
 */
router.post(
  '/assets/:id/ingest',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    // Fetch the asset
    const { data: asset, error: fetchError } = await req.supabase
      .from('content_assets')
      .select('*')
      .eq('asset_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      console.error('Error fetching asset:', fetchError);
      res.status(500).json({ error: 'Failed to fetch asset' });
      return;
    }

    // Determine content to ingest
    let contentToIngest: string | null = null;

    if (asset.content_body) {
      contentToIngest = asset.content_body;
    } else if (asset.content_structured) {
      contentToIngest = JSON.stringify(asset.content_structured);
    }

    // TODO: Phase 2 — if asset has file_path, extract text from file (PDF, DOCX, etc.)
    // TODO: Phase 2 — if asset has external_url, fetch and extract content
    // TODO: Phase 2 — AI auto-tag via MM or Claude

    if (!contentToIngest) {
      res.status(400).json({
        error: 'No content to ingest. Asset must have content_body, content_structured, file_path, or external_url',
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'Embedding service not configured (OPENAI_API_KEY missing)' });
      return;
    }

    try {
      const result = await ingestContent({
        contract_id: asset.contract_id,
        source_type: 'content',
        source_id: asset.asset_id,
        title: asset.title,
        content: contentToIngest,
        metadata: {
          content_type_id: asset.content_type_id,
          category_id: asset.category_id,
          asset_status: asset.status,
        },
      });

      // Update asset metadata with ingestion info
      const updatedMetadata = {
        ...(asset.metadata || {}),
        last_ingested_at: new Date().toISOString(),
        chunks_created: result.chunks_created,
      };

      await req.supabase
        .from('content_assets')
        .update({ metadata: updatedMetadata })
        .eq('asset_id', id);

      res.json({
        message: 'Content ingested successfully',
        chunks_created: result.chunks_created,
      });
    } catch (err) {
      console.error('[Content] Ingestion failed:', err);
      res.status(500).json({ error: 'Failed to ingest content' });
    }
  }
);

export default router;
