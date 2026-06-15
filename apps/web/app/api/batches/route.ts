export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/services/supabase'
import { parseEmailBuffer } from '@/lib/services/emailParser'
import { extractOrdersFromEmail } from '@/lib/services/claude'
import type { ClaudeOrder, ClaudeFieldValidation, ValidationStatus } from '@fc/shared'

function generateBatchCode(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const seq = Math.floor(Math.random() * 900) + 100
  return `FC-${date}-${seq}`
}

// All fields we want shown in the UI, in display order
const ORDER_FIELDS: { key: keyof ClaudeOrder; label: string }[] = [
  { key: 'customer_name',      label: 'ชื่อลูกค้า' },
  { key: 'company_name',       label: 'บริษัท' },
  { key: 'circuit_order_type', label: 'ประเภทวงจร' },
  { key: 'old_circuit',        label: 'วงจรเดิม' },
  { key: 'product_package',    label: 'แพ็คเกจ' },
  { key: 'speed',              label: 'ความเร็ว' },
  { key: 'store_code',         label: 'รหัสสาขา' },
  { key: 'branch_name',        label: 'ชื่อสาขา' },
  { key: 'coordinator_name',   label: 'ผู้ประสานงาน' },
  { key: 'coordinator_phone',  label: 'เบอร์ติดต่อ' },
]

const ADDRESS_FIELDS: { key: string; label: string }[] = [
  { key: 'house_no',    label: 'บ้านเลขที่' },
  { key: 'moo',         label: 'หมู่ที่' },
  { key: 'building',    label: 'อาคาร' },
  { key: 'floor',       label: 'ชั้น' },
  { key: 'room',        label: 'ห้อง' },
  { key: 'soi',         label: 'ซอย' },
  { key: 'road',        label: 'ถนน' },
  { key: 'subdistrict', label: 'แขวง/ตำบล' },
  { key: 'district',    label: 'เขต/อำเภอ' },
  { key: 'province',    label: 'จังหวัด' },
  { key: 'postcode',    label: 'รหัสไปรษณีย์' },
  { key: 'latitude',    label: 'ละติจูด' },
  { key: 'longitude',   label: 'ลองจิจูด' },
]

/**
 * Merge Claude's explicit field validations with auto-generated rows for
 * every field that Claude found but didn't validate, and every null field.
 * This guarantees the extraction table always shows the full picture.
 */
function buildCompleteValidations(o: ClaudeOrder): ClaudeFieldValidation[] {
  // Index Claude's explicit validations by field name (last one wins on duplicates)
  const explicit = new Map<string, ClaudeFieldValidation>()
  for (const f of o.fields ?? []) {
    explicit.set(f.field_name, f)
  }

  const result: ClaudeFieldValidation[] = []

  // Order-level fields
  for (const { key } of ORDER_FIELDS) {
    if (explicit.has(key)) {
      result.push(explicit.get(key)!)
      continue
    }
    const raw = o[key]
    const value = raw != null ? String(raw) : undefined
    result.push({
      field_name: key,
      value: value ?? '',
      status: (value ? 'correct' : 'missing') as ValidationStatus,
      ai_note: value ? '' : 'ไม่พบข้อมูลในอีเมลหรือไฟล์แนบ',
      confidence: value ? 0.9 : 0,
    })
  }

  // Address fields
  for (const { key } of ADDRESS_FIELDS) {
    if (explicit.has(key)) {
      result.push(explicit.get(key)!)
      continue
    }
    const raw = o.address?.[key as keyof typeof o.address]
    const value = raw != null ? String(raw) : undefined
    result.push({
      field_name: key,
      value: value ?? '',
      status: (value ? 'correct' : 'missing') as ValidationStatus,
      ai_note: value ? '' : 'ไม่พบข้อมูลในอีเมลหรือไฟล์แนบ',
      confidence: value ? 0.9 : 0,
    })
  }

  return result
}

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    console.error('[batches] formData parse error:', err)
    return NextResponse.json({ error: 'Invalid multipart form data', detail: String(err) }, { status: 400 })
  }

  const file = formData.get('email')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No email file uploaded' }, { status: 400 })
  }

  if (!/\.(eml|msg)$/i.test(file.name)) {
    return NextResponse.json({ error: 'Only .eml and .msg files are supported' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let parsed
  try {
    parsed = await parseEmailBuffer(buffer)
  } catch (err) {
    console.error('[batches] email parse error:', err)
    return NextResponse.json({ error: 'Failed to parse email', detail: String(err) }, { status: 422 })
  }

  console.log('[batches] parsed — subject:', parsed.subject, '| bodyLen:', parsed.bodyText.length, '| excelRows:', parsed.rawExcelRows.length)

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
    console.error('[batches] Supabase insert error:', batchErr)
    return NextResponse.json({ error: 'Failed to create batch', detail: batchErr?.message }, { status: 500 })
  }

  let extraction
  try {
    extraction = await extractOrdersFromEmail(parsed.bodyText, parsed.excelRows)
  } catch (err) {
    await supabase.from('batches').update({ status: 'error' }).eq('id', batch.id)
    return NextResponse.json({ error: 'Claude extraction failed', detail: String(err) }, { status: 502 })
  }

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
        // 'suggested' is only valid for field-level status, not the order overall
        ai_status: (['correct','missing','suspicious','incorrect'] as string[]).includes(o.ai_status)
          ? o.ai_status
          : 'suspicious',
      })
      .select()
      .single()

    if (orderErr || !order) {
      console.error('[batches] order insert error:', orderErr)
      continue
    }

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

    // Build complete validations — every field gets a row
    const allValidations = buildCompleteValidations(o)
    await supabase.from('field_validations').insert(
      allValidations.map((f) => ({
        order_id: order.id,
        field_name: f.field_name,
        value: f.value ?? null,
        status: f.status,
        ai_note: f.ai_note ?? null,
        confidence: f.confidence ?? null,
      })),
    )

    await supabase.from('reviews').insert({
      order_id: order.id,
      is_status: 'pending',
      reviewer: null,
      note: null,
      reviewed_at: null,
    })

    createdOrders.push(order.id)
  }

  await supabase.from('batches').update({ status: 'done' }).eq('id', batch.id)

  // Re-fetch with all joins so the frontend gets addresses + field_validations immediately
  const { data: fullOrders } = await supabase
    .from('orders')
    .select('*, addresses(*), field_validations(*), reviews(*)')
    .eq('batch_id', batch.id)
    .order('seq')

  return NextResponse.json(
    { batch: { ...batch, status: 'done' }, orders: fullOrders ?? [] },
    { status: 201 },
  )
}
