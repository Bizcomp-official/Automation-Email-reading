import { Router } from 'express'
import { supabase } from '../services/supabase'

export const ordersRouter = Router()

// GET /api/orders — History list
ordersRouter.get('/', async (req, res) => {
  const { q, status, from_date, to_date, limit = '50', offset = '0' } = req.query as Record<string, string>

  // Build the base query joining all needed tables
  let query = supabase
    .from('orders')
    .select(
      `id, seq, customer_name, company_name, ai_status, created_at,
       batch_id,
       batches!inner(batch_code),
       addresses(subdistrict, district, province, postcode),
       reviews(is_status)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1)

  if (q) {
    query = query.or(
      `customer_name.ilike.%${q}%,company_name.ilike.%${q}%`,
    )
  }

  if (status && status !== 'all') {
    // filter by review status — requires a subquery workaround via RPC or post-filter
    // We post-filter after fetch to keep it simple
  }

  if (from_date) {
    query = query.gte('created_at', from_date)
  }
  if (to_date) {
    query = query.lte('created_at', to_date)
  }

  const { data, count, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = (data ?? []).map((o: any) => ({
    id: o.id,
    batch_id: o.batch_id,
    batch_code: o.batches?.batch_code ?? null,
    seq: o.seq,
    customer_name: o.customer_name,
    company_name: o.company_name,
    ai_status: o.ai_status,
    created_at: o.created_at,
    address_summary: buildAddressSummary(o.addresses),
    province: o.addresses?.province ?? null,
    review_status: o.reviews?.is_status ?? 'pending',
  }))

  if (status && status !== 'all') {
    rows = rows.filter((r) => r.review_status === status)
  }

  res.json({ data: rows, count: count ?? rows.length })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAddressSummary(addr: any): string | null {
  if (!addr) return null
  const parts = [addr.subdistrict, addr.district, addr.province, addr.postcode].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

// GET /api/orders/:id — full detail
ordersRouter.get('/:id', async (req, res) => {
  const { id } = req.params

  const { data, error } = await supabase
    .from('orders')
    .select('*, batches(batch_code), addresses(*), field_validations(*), reviews(*)')
    .eq('id', id)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Order not found' })
    return
  }

  res.json(data)
})

// PATCH /api/orders/:id/review
ordersRouter.patch('/:id/review', async (req, res) => {
  const { id } = req.params
  const { is_status, note, reviewer } = req.body as {
    is_status: 'pending' | 'verified' | 'flagged'
    note?: string
    reviewer?: string
  }

  if (!is_status) {
    res.status(400).json({ error: 'is_status is required' })
    return
  }

  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      {
        order_id: id,
        is_status,
        note: note ?? null,
        reviewer: reviewer ?? null,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'order_id' },
    )
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})
