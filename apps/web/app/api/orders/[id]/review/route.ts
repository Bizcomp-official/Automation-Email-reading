export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/services/supabase'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json() as { is_status?: string; note?: string; reviewer?: string }

  if (!body.is_status) {
    return NextResponse.json({ error: 'is_status is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      {
        order_id: id,
        is_status: body.is_status,
        note: body.note ?? null,
        reviewer: body.reviewer ?? null,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'order_id' },
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
