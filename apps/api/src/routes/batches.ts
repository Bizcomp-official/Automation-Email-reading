import { Router } from 'express'
import multer from 'multer'
import { supabase } from '../services/supabase'
import { parseEmailFile } from '../services/emailParser'
import { extractOrdersFromEmail } from '../services/claude'
import type { ClaudeOrder } from '@fc/shared'

export const batchesRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(eml|msg)$/i.test(file.originalname)
    cb(null, ok)
  },
})

function generateBatchCode(): string {
  const d = new Date()
  const date = d.toISOString().slice(0, 10).replace(/-/g, '')
  const seq = Math.floor(Math.random() * 900) + 100
  return `FC-${date}-${seq}`
}

batchesRouter.post('/', upload.single('email'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No email file uploaded' })
    return
  }

  try {
    const parsed = await parseEmailFile(req.file.buffer, req.file.mimetype)

    // Insert batch
    const batchCode = generateBatchCode()
    const { data: batch, error: batchErr } = await supabase
      .from('batches')
      .insert({
        batch_code: batchCode,
        source: 'email',
        email_subject: parsed.subject || null,
        email_from: parsed.from || null,
        received_at: parsed.receivedAt?.toISOString() ?? null,
        status: 'processing',
      })
      .select()
      .single()

    if (batchErr || !batch) {
      res.status(500).json({ error: 'Failed to create batch', detail: batchErr?.message })
      return
    }

    // Call Claude
    let extraction
    try {
      extraction = await extractOrdersFromEmail(parsed.bodyText, parsed.excelTable)
    } catch (err) {
      await supabase.from('batches').update({ status: 'error' }).eq('id', batch.id)
      res.status(502).json({ error: 'Claude extraction failed', detail: String(err) })
      return
    }

    // Persist orders, addresses, field_validations, reviews
    const createdOrders = []
    for (let i = 0; i < extraction.orders.length; i++) {
      const o: ClaudeOrder = extraction.orders[i]

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          batch_id: batch.id,
          seq: i + 1,
          customer_name: o.customer_name ?? null,
          company_name: o.company_name ?? null,
          circuit_order_type: o.circuit_order_type ?? null,
          old_circuit: o.old_circuit ?? null,
          product_package: o.product_package ?? null,
          speed: o.speed ?? null,
          store_code: o.store_code ?? null,
          branch_name: o.branch_name ?? null,
          coordinator_name: o.coordinator_name ?? null,
          coordinator_phone: o.coordinator_phone ?? null,
          source_ref: o.source_ref ?? null,
          ai_status: o.ai_status,
        })
        .select()
        .single()

      if (orderErr || !order) continue

      await supabase.from('addresses').insert({
        order_id: order.id,
        house_no: o.address?.house_no ?? null,
        moo: o.address?.moo ?? null,
        building: o.address?.building ?? null,
        floor: o.address?.floor ?? null,
        room: o.address?.room ?? null,
        soi: o.address?.soi ?? null,
        road: o.address?.road ?? null,
        subdistrict: o.address?.subdistrict ?? null,
        district: o.address?.district ?? null,
        province: o.address?.province ?? null,
        postcode: o.address?.postcode ?? null,
        latitude: o.address?.latitude ?? null,
        longitude: o.address?.longitude ?? null,
        input_format: o.address?.input_format ?? 'plain_text',
        geocode_confidence: null,
      })

      if (o.fields?.length) {
        await supabase.from('field_validations').insert(
          o.fields.map((f) => ({
            order_id: order.id,
            field_name: f.field_name,
            value: f.value ?? null,
            status: f.status,
            ai_note: f.ai_note ?? null,
            confidence: f.confidence ?? null,
          })),
        )
      }

      await supabase.from('reviews').insert({
        order_id: order.id,
        is_status: 'pending',
        reviewer: null,
        note: null,
        reviewed_at: null,
      })

      createdOrders.push(order)
    }

    await supabase.from('batches').update({ status: 'done' }).eq('id', batch.id)

    res.status(201).json({ batch: { ...batch, status: 'done' }, orders: createdOrders })
  } catch (err) {
    console.error('POST /api/batches error:', err)
    res.status(500).json({ error: 'Internal server error', detail: String(err) })
  }
})

batchesRouter.get('/:id', async (req, res) => {
  const { id } = req.params

  const { data: batch, error } = await supabase
    .from('batches')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !batch) {
    res.status(404).json({ error: 'Batch not found' })
    return
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('*, addresses(*), field_validations(*), reviews(*)')
    .eq('batch_id', id)
    .order('seq')

  res.json({ ...batch, orders: orders ?? [] })
})
