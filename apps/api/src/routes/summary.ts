import { Router } from 'express'
import { supabase } from '../services/supabase'

export const summaryRouter = Router()

summaryRouter.get('/', async (_req, res) => {
  const [reviewsResult, confidenceResult] = await Promise.all([
    supabase.from('reviews').select('is_status'),
    supabase.from('field_validations').select('confidence'),
  ])

  if (reviewsResult.error || confidenceResult.error) {
    res.status(500).json({ error: 'Failed to fetch summary' })
    return
  }

  const reviews = reviewsResult.data ?? []
  const total = reviews.length
  const verified = reviews.filter((r) => r.is_status === 'verified').length
  const pending = reviews.filter((r) => r.is_status === 'pending').length
  const flagged = reviews.filter((r) => r.is_status === 'flagged').length

  const confidences = (confidenceResult.data ?? [])
    .map((r) => r.confidence)
    .filter((c): c is number => c !== null && c !== undefined)

  const avg_confidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : null

  res.json({ total, verified, pending, flagged, avg_confidence })
})
