export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/services/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { data, error } = await supabase
    .from('orders')
    .select('*, batches(batch_code), addresses(*), field_validations(*), reviews(*)')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}
