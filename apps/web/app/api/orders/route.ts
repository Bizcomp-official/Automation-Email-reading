export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/services/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAddressSummary(addr: any): string | null {
  if (!addr) return null
  const parts = [addr.subdistrict, addr.district, addr.province, addr.postcode].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? 'all'
  const from_date = searchParams.get('from_date')
  const to_date = searchParams.get('to_date')
  const limit = Number(searchParams.get('limit') ?? '50')
  const offset = Number(searchParams.get('offset') ?? '0')

  let query = supabase
    .from('orders')
    .select(
      `id, seq, customer_name, company_name, branch_name, ai_status, created_at, customer_note,
       batch_id,
       batches!inner(batch_code, email_from),
       addresses(subdistrict, district, province, postcode),
       reviews(is_status)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.or(`customer_name.ilike.%${q}%,company_name.ilike.%${q}%`)
  }
  if (from_date) query = query.gte('created_at', from_date)
  if (to_date) query = query.lte('created_at', to_date)

  const { data, count, error } = await query

  if (error) {
    console.error('[orders] Supabase query error:', error)
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = (data ?? []).map((o: any) => ({
    id: o.id,
    batch_id: o.batch_id,
    batch_code: o.batches?.batch_code ?? null,
    email_from: o.batches?.email_from ?? null,
    seq: o.seq,
    customer_name: o.customer_name,
    company_name: o.company_name,
    branch_name: o.branch_name ?? null,
    ai_status: o.ai_status,
    created_at: o.created_at,
    address_summary: buildAddressSummary(o.addresses),
    province: o.addresses?.province ?? null,
    review_status: o.reviews?.is_status ?? 'pending',
    customer_note: o.customer_note ?? null,
  }))

  if (status && status !== 'all') {
    rows = rows.filter((r) => r.review_status === status)
  }

  return NextResponse.json({ data: rows, count: count ?? rows.length })
}
