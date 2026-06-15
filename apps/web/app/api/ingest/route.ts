export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

// TODO: RPA → website ingest API — not configured yet.
// Design pending RPA-side spec from the customer.
export async function POST() {
  return NextResponse.json(
    {
      error: 'Not Implemented',
      message: 'RPA ingest endpoint is not configured yet. Use the manual upload path at POST /api/batches.',
    },
    { status: 501 },
  )
}
