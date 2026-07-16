export const runtime = 'nodejs'
export const maxDuration = 300 // seconds — Vercel hobby plan max

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/services/supabase'
import { parseEmailBuffer } from '@/lib/services/emailParser'
import { extractOrdersFromEmail } from '@/lib/services/claude'
import { resolveSubdistrict, resolveDistrict, resolveProvince, hasPostcode } from '@/lib/services/postcodeResolver'
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

// Apply postcode-table resolution for subdistrict / district.
// Returns null for other keys or when postcode / value is absent.
function resolveAddrField(
  key: string,
  rawValue: string | undefined | null,
  postcode: string | undefined | null,
): { value: string; status: ValidationStatus; ai_note: string; confidence: number } | null {
  if (key !== 'subdistrict' && key !== 'district' && key !== 'province') return null
  if (!rawValue || !postcode) return null
  if (!hasPostcode(postcode)) return null  // Unknown postcode — leave Claude's validation untouched
  const resolved =
    key === 'subdistrict' ? resolveSubdistrict(rawValue, postcode) :
    key === 'district'    ? resolveDistrict(rawValue, postcode) :
                            resolveProvince(rawValue, postcode)
  return {
    value: resolved.value,
    status: resolved.status as ValidationStatus,
    ai_note: resolved.ai_note,
    confidence: resolved.status === 'correct' ? 0.99 : 0.4,
  }
}

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
  const isOffice = o.address?.is_office_known_location === true
  const postcode = o.address?.postcode ?? null
  for (const { key } of ADDRESS_FIELDS) {
    if (explicit.has(key)) {
      const e = explicit.get(key)!
      const override = resolveAddrField(key, e.value, postcode)
      result.push(override ? { ...e, ...override } : e)
      continue
    }
    const raw = o.address?.[key as keyof typeof o.address]
    const value = raw != null && raw !== false ? String(raw) : undefined

    // lat/lng get special treatment: office = correct (no GPS needed), else missing
    if ((key === 'latitude' || key === 'longitude') && !value) {
      result.push({
        field_name: key,
        value: '',
        status: (isOffice ? 'correct' : 'missing') as ValidationStatus,
        ai_note: isOffice ? 'สำนักงาน – ทราบตำแหน่งแล้ว ไม่ต้องการพิกัด GPS' : 'ต้องการพิกัด GPS จาก AE',
        confidence: isOffice ? 1 : 0,
      })
      continue
    }

    const override = resolveAddrField(key, value, postcode)
    if (override) {
      result.push({ field_name: key, ...override })
      continue
    }

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
    parsed = await parseEmailBuffer(buffer, file.name)
  } catch (err) {
    console.error('[batches] email parse error:', err)
    const detail = String(err).replace(/^Error:\s*/, '')
    return NextResponse.json({ error: detail || 'Failed to parse email' }, { status: 422 })
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
    console.error('[batches] Supabase insert error:', batchErr?.message, batchErr?.code, batchErr?.details, batchErr?.hint)
    return NextResponse.json({ error: 'Failed to create batch', detail: batchErr?.message }, { status: 500 })
  }

  let extraction
  try {
    extraction = await extractOrdersFromEmail(parsed.bodyText, parsed.excelRows, parsed.rawExcelRows)
  } catch (err) {
    console.error('[batches] extraction failed:', String(err))
    await supabase.from('batches').update({ status: 'error' }).eq('id', batch.id)
    return NextResponse.json({ error: 'Claude extraction failed', detail: String(err) }, { status: 502 })
  }

  // Bulk insert all orders in one round-trip
  if (extraction.orders.length === 0) {
    console.error('[batches] Claude returned 0 orders — email has no recognisable order data')
    await supabase.from('batches').update({ status: 'error' }).eq('id', batch.id)
    return NextResponse.json(
      { error: 'AI ไม่พบข้อมูล order ในอีเมลนี้ — กรุณาตรวจสอบว่าอีเมลมีข้อมูลคำสั่งติดตั้ง FC' },
      { status: 422 },
    )
  }

  const validAiStatuses = ['correct', 'missing', 'suspicious', 'incorrect']
  const { data: createdOrders, error: ordersErr } = await supabase
    .from('orders')
    .insert(
      extraction.orders.map((o, i) => ({
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
        customer_note: o.customer_note ?? null,
        ai_status: validAiStatuses.includes(o.ai_status) ? o.ai_status : 'suspicious',
      })),
    )
    .select()

  if (ordersErr || !createdOrders?.length) {
    console.error('[batches] orders bulk insert error:', ordersErr?.message, ordersErr?.code)
    await supabase.from('batches').update({ status: 'error' }).eq('id', batch.id)
    return NextResponse.json({ error: 'Failed to insert orders', detail: ordersErr?.message }, { status: 500 })
  }

  // Bulk insert addresses, field_validations, reviews — all in parallel
  await Promise.all([
    supabase.from('addresses').insert(
      createdOrders.map((order, i) => {
        const addr = extraction.orders[i].address
        return {
          order_id: order.id,
          house_no: addr?.house_no ?? null,
          moo: addr?.moo ?? null,
          building: addr?.building ?? null,
          floor: addr?.floor ?? null,
          room: addr?.room ?? null,
          soi: addr?.soi ?? null,
          road: addr?.road ?? null,
          subdistrict: addr?.subdistrict ?? null,
          district: addr?.district ?? null,
          province: addr?.province ?? null,
          postcode: addr?.postcode ?? null,
          latitude: addr?.latitude ?? null,
          longitude: addr?.longitude ?? null,
          input_format: addr?.input_format ?? 'plain_text',
          geocode_confidence: null,
        }
      }),
    ),
    supabase.from('field_validations').insert(
      createdOrders.flatMap((order, i) =>
        buildCompleteValidations(extraction.orders[i]).map((f) => ({
          order_id: order.id,
          field_name: f.field_name,
          value: f.value ?? null,
          status: f.status,
          ai_note: f.ai_note ?? null,
          confidence: f.confidence ?? null,
        })),
      ),
    ),
    supabase.from('reviews').insert(
      createdOrders.map((order) => ({
        order_id: order.id,
        is_status: 'pending',
        reviewer: null,
        note: null,
        reviewed_at: null,
      })),
    ),
  ])

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
