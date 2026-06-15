export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/services/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { data: batch, error } = await supabase
    .from('batches')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('*, addresses(*), field_validations(*), reviews(*)')
    .eq('batch_id', id)
    .order('seq')

  return NextResponse.json({ ...batch, orders: orders ?? [] })
}
