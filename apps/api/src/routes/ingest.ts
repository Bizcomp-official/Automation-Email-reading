import { Router } from 'express'

export const ingestRouter = Router()

// TODO: RPA → website ingest API — not configured yet.
// Design pending RPA-side spec from the customer.
ingestRouter.post('/', (_req, res) => {
  res.status(501).json({
    error: 'Not Implemented',
    message: 'RPA ingest endpoint is not configured yet. Use the manual upload path at POST /api/batches.',
  })
})
