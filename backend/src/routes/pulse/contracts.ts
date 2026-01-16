import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /api/contracts
 * List contracts based on user role:
 * - admin/team_member: See all contracts
 * - client: See only contracts they have access to via user_contract_access
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    let query = req.supabase
      .from('contracts')
      .select(`
        id,
        name,
        status,
        start_date,
        end_date,
        monthly_retainer,
        account:accounts(id, name),
        created_at,
        updated_at
      `)
      .order('created_at', { ascending: false });

    // Clients only see contracts they have explicit access to
    if (req.user.role === 'client') {
      const { data: accessList } = await req.supabase
        .from('user_contract_access')
        .select('contract_id')
        .eq('user_id', req.user.id);

      const contractIds = accessList?.map((a) => a.contract_id) || [];

      if (contractIds.length === 0) {
        res.json({ contracts: [] });
        return;
      }

      query = query.in('id', contractIds);
    }

    const { data: contracts, error } = await query;

    if (error) {
      console.error('Error fetching contracts:', error);
      res.status(500).json({ error: 'Failed to fetch contracts' });
      return;
    }

    res.json({ contracts: contracts || [] });
  } catch (error) {
    console.error('Error fetching contracts:', error);
    res.status(500).json({ error: 'Failed to fetch contracts' });
  }
});

/**
 * GET /api/contracts/:id
 * Get a single contract detail
 * - admin/team_member: Can access any contract
 * - client: Can only access if they have user_contract_access
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    // Check client access
    if (req.user.role === 'client') {
      const { data: access } = await req.supabase
        .from('user_contract_access')
        .select('id')
        .eq('user_id', req.user.id)
        .eq('contract_id', id)
        .single();

      if (!access) {
        res.status(403).json({
          error: 'Access denied to this contract',
          code: 'CONTRACT_ACCESS_DENIED'
        });
        return;
      }
    }

    const { data: contract, error } = await req.supabase
      .from('contracts')
      .select(`
        id,
        name,
        status,
        start_date,
        end_date,
        monthly_retainer,
        clickup_folder_id,
        clickup_list_id,
        quickbooks_customer_id,
        hubspot_company_id,
        compass_enabled,
        enabled_apps,
        account:accounts(
          id,
          name,
          hubspot_id
        ),
        created_at,
        updated_at
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      console.error('Error fetching contract:', error);
      res.status(500).json({ error: 'Failed to fetch contract' });
      return;
    }

    res.json({ contract });
  } catch (error) {
    console.error('Error fetching contract:', error);
    res.status(500).json({ error: 'Failed to fetch contract' });
  }
});

export default router;
