import { Router, Request, Response } from 'express';
import {
  validateContractEnums,
  CreateContractDTO,
  UpdateContractDTO,
  ContractListItem,
  ContractWithAccount
} from '../../types/contracts';

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
        contract_id,
        contract_name,
        contract_status,
        contract_type,
        engagement_type,
        priority,
        amount,
        contract_start_date,
        contract_end_date,
        account:accounts(account_id, name),
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

      query = query.in('contract_id', contractIds);
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
 * POST /api/contracts/import
 * Bulk import contracts with upsert logic
 * - admin/team_member only
 * - Matches existing contracts by external_id or contract_name
 * - Updates if found, inserts if not
 */
router.post('/import', async (req: Request, res: Response): Promise<void> => {
  console.log('[Import] Starting contract import...');

  try {
    if (!req.supabase || !req.user) {
      console.log('[Import] Not authenticated');
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Only admin and team_member can import contracts
    if (req.user.role === 'client') {
      console.log('[Import] Access denied for client role');
      res.status(403).json({
        error: 'Access denied',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
      return;
    }

    const { contracts } = req.body as { contracts: CreateContractDTO[] };

    if (!contracts || !Array.isArray(contracts) || contracts.length === 0) {
      console.log('[Import] No contracts in request body');
      res.status(400).json({ error: 'contracts array is required and must not be empty' });
      return;
    }

    console.log(`[Import] Processing ${contracts.length} contracts...`);

    const result = {
      inserted: 0,
      updated: 0,
      errors: [] as string[]
    };

    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i];

      // Validate required fields
      if (!contract.contract_name) {
        result.errors.push(`Missing contract_name for contract`);
        continue;
      }

      if (!contract.contract_status) {
        result.errors.push(`Missing contract_status for ${contract.contract_name}`);
        continue;
      }

      if (!contract.contract_type) {
        result.errors.push(`Missing contract_type for ${contract.contract_name}`);
        continue;
      }

      if (!contract.contract_start_date) {
        result.errors.push(`Missing contract_start_date for ${contract.contract_name}`);
        continue;
      }

      // Validate enum values
      const validationErrors = validateContractEnums(contract);
      if (validationErrors.length > 0) {
        result.errors.push(`Invalid enum values for ${contract.contract_name}: ${validationErrors.join(', ')}`);
        continue;
      }

      try {
        // Check if contract exists by external_id first, then by contract_name
        let existing = null;

        if (contract.external_id) {
          const { data } = await req.supabase
            .from('contracts')
            .select('contract_id')
            .eq('external_id', contract.external_id)
            .maybeSingle();
          existing = data;
        }

        // If not found by external_id, try by contract_name
        if (!existing) {
          const { data } = await req.supabase
            .from('contracts')
            .select('contract_id')
            .eq('contract_name', contract.contract_name)
            .maybeSingle();
          existing = data;
        }

        // Prepare contract data (exclude undefined values)
        const contractData: Record<string, unknown> = {};
        const fields = [
          'contract_name', 'contract_status', 'contract_type', 'contract_start_date',
          'contract_end_date', 'contract_renewal_date', 'contract_description', 'amount',
          'quickbooks_customer_id', 'quickbooks_business_unit_id', 'external_id', 'deal_id',
          'engagement_type', 'payment_type', 'monthly_points_allotment', 'priority',
          'customer_display_type', 'hosting', 'account_manager', 'team_manager',
          'clickup_folder_id', 'slack_channel_internal', 'slack_channel_external',
          'dollar_per_hour', 'autorenewal', 'initial_term_length', 'subsequent_term_length',
          'notice_period', 'next_invoice_date', 'account_id'
        ];

        for (const field of fields) {
          const contractRecord = contract as unknown as Record<string, unknown>;
          if (contractRecord[field] !== undefined) {
            contractData[field] = contractRecord[field];
          }
        }

        if (existing) {
          // Update existing contract
          contractData.updated_at = new Date().toISOString();
          const { error } = await req.supabase
            .from('contracts')
            .update(contractData)
            .eq('contract_id', existing.contract_id);

          if (error) {
            console.log(`[Import] Failed to update ${contract.contract_name}: ${error.message}`);
            result.errors.push(`Failed to update ${contract.contract_name}: ${error.message}`);
          } else {
            result.updated++;
          }
        } else {
          // Insert new contract
          const { error } = await req.supabase
            .from('contracts')
            .insert(contractData);

          if (error) {
            console.log(`[Import] Failed to insert ${contract.contract_name}: ${error.message}`);
            result.errors.push(`Failed to insert ${contract.contract_name}: ${error.message}`);
          } else {
            result.inserted++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.log(`[Import] Error processing ${contract.contract_name}: ${message}`);
        result.errors.push(`Error processing ${contract.contract_name}: ${message}`);
      }

      // Log progress every 10 contracts
      if ((i + 1) % 10 === 0) {
        console.log(`[Import] Progress: ${i + 1}/${contracts.length} contracts processed`);
      }
    }

    console.log(`[Import] Complete. Inserted: ${result.inserted}, Updated: ${result.updated}, Errors: ${result.errors.length}`);
    res.json(result);
  } catch (error) {
    console.error('[Import] Fatal error:', error);
    res.status(500).json({ error: 'Failed to import contracts' });
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
        contract_id,
        external_id,
        contract_name,
        contract_status,
        contract_type,
        engagement_type,
        amount,
        payment_type,
        monthly_points_allotment,
        dollar_per_hour,
        contract_start_date,
        contract_end_date,
        contract_renewal_date,
        next_invoice_date,
        initial_term_length,
        subsequent_term_length,
        notice_period,
        autorenewal,
        account_manager,
        team_manager,
        clickup_folder_id,
        quickbooks_customer_id,
        quickbooks_business_unit_id,
        deal_id,
        slack_channel_internal,
        slack_channel_external,
        customer_display_type,
        hosting,
        priority,
        contract_description,
        account:accounts(
          account_id,
          name,
          hubspot_account_id
        ),
        created_at,
        updated_at
      `)
      .eq('contract_id', id)
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

/**
 * POST /api/contracts
 * Create a new contract
 * - admin/team_member only
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Only admin and team_member can create contracts
    if (req.user.role === 'client') {
      res.status(403).json({
        error: 'Access denied',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
      return;
    }

    const contractData: CreateContractDTO = req.body;

    // Validate required fields
    if (!contractData.contract_name) {
      res.status(400).json({ error: 'contract_name is required' });
      return;
    }

    if (!contractData.contract_status) {
      res.status(400).json({ error: 'contract_status is required' });
      return;
    }

    if (!contractData.contract_type) {
      res.status(400).json({ error: 'contract_type is required' });
      return;
    }

    if (!contractData.contract_start_date) {
      res.status(400).json({ error: 'contract_start_date is required' });
      return;
    }

    // Validate enum values
    const validationErrors = validateContractEnums(contractData);
    if (validationErrors.length > 0) {
      res.status(400).json({
        error: 'Invalid enum values',
        details: validationErrors
      });
      return;
    }

    const { data: contract, error } = await req.supabase
      .from('contracts')
      .insert(contractData)
      .select()
      .single();

    if (error) {
      console.error('Error creating contract:', error);
      res.status(500).json({ error: 'Failed to create contract' });
      return;
    }

    res.status(201).json({ contract });
  } catch (error) {
    console.error('Error creating contract:', error);
    res.status(500).json({ error: 'Failed to create contract' });
  }
});

/**
 * PUT /api/contracts/:id
 * Update a contract
 * - admin/team_member only
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Only admin and team_member can update contracts
    if (req.user.role === 'client') {
      res.status(403).json({
        error: 'Access denied',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
      return;
    }

    const { id } = req.params;
    const updateData: Partial<CreateContractDTO> = req.body;

    // Validate enum values if provided
    const validationErrors = validateContractEnums(updateData);
    if (validationErrors.length > 0) {
      res.status(400).json({
        error: 'Invalid enum values',
        details: validationErrors
      });
      return;
    }

    const { data: contract, error } = await req.supabase
      .from('contracts')
      .update(updateData)
      .eq('contract_id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      console.error('Error updating contract:', error);
      res.status(500).json({ error: 'Failed to update contract' });
      return;
    }

    res.json({ contract });
  } catch (error) {
    console.error('Error updating contract:', error);
    res.status(500).json({ error: 'Failed to update contract' });
  }
});

/**
 * DELETE /api/contracts/:id
 * Delete a contract
 * - admin only
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Only admin can delete contracts
    if (req.user.role !== 'admin') {
      res.status(403).json({
        error: 'Access denied',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
      return;
    }

    const { id } = req.params;

    const { error } = await req.supabase
      .from('contracts')
      .delete()
      .eq('contract_id', id);

    if (error) {
      console.error('Error deleting contract:', error);
      res.status(500).json({ error: 'Failed to delete contract' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting contract:', error);
    res.status(500).json({ error: 'Failed to delete contract' });
  }
});

export default router;
