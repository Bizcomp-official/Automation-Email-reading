export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/services/supabase'

const REQUIRED_FIELDS = new Set([
  'circuit_order_type', 'product_package', 'speed',
  'coordinator_name', 'coordinator_phone',
  'latitude', 'longitude',
])

const FIELD_LABELS: Record<string, string> = {
  circuit_order_type:  'ประเภทวงจร',
  product_package:     'แพ็กเกจ',
  speed:               'ความเร็ว',
  coordinator_name:    'ผู้ประสานงาน',
  coordinator_phone:   'เบอร์ติดต่อ',
  latitude:            'ละติจูด (พิกัด GPS)',
  longitude:           'ลองจิจูด (พิกัด GPS)',
}

// Bucket field names into human-readable purpose tags
function toPurpose(field: string): string {
  if (field === 'latitude' || field === 'longitude') return 'พิกัด GPS'
  if (field === 'product_package' || field === 'speed')  return 'แพ็กเกจ / ความเร็ว'
  if (field === 'coordinator_name' || field === 'coordinator_phone') return 'ผู้ประสานงาน'
  if (field === 'circuit_order_type') return 'ประเภทวงจร'
  return 'อื่นๆ'
}

function buildEmailBody(company: string, ae: string, missingFields: string[]): string {
  const hasGps = missingFields.some(f => f === 'latitude' || f === 'longitude')
  const others = missingFields.filter(f => f !== 'latitude' && f !== 'longitude')

  const lines: string[] = [
    ...others.map(f => `• ${FIELD_LABELS[f] ?? f}`),
    ...(hasGps ? ['• พิกัด GPS (ละติจูด / ลองจิจูด) — กรุณาแชร์ลิงก์ Google Maps หรือระบุค่าพิกัดของสถานที่ติดตั้ง'] : []),
  ]

  return `เรียน ${ae || '[ชื่อ AE]'},
รบกวนขอข้อมูลเพิ่มเติมของลูกค้า ${company} ค่ะ เนื่องจากเป็นข้อมูลจำเป็น (required)
ที่ต้องกรอกใน Check Fact ก่อนส่งเข้าระบบ E-Ordering

ข้อมูลที่ขาด:
${lines.join('\n')}

เมื่อได้รับแล้วจะดำเนินการส่ง FC เข้าระบบและแจ้งเลข FC No. กลับให้ทันทีค่ะ

ขอบคุณค่ะ
Inside Sales`
}

function buildConsolidatedBody(
  batchCode: string,
  ae: string,
  byPurpose: Record<string, Array<{ company: string; missing: string[] }>>,
): string {
  const sections = Object.entries(byPurpose).map(([purpose, items]) => {
    const lines = items.map(i => `  • ${i.company}`).join('\n')
    return `【 ${purpose} 】 (${items.length} sites)\n${lines}`
  })

  return `เรียน ${ae || '[ชื่อ AE]'},
รบกวนขอข้อมูลเพิ่มเติม batch ${batchCode} ค่ะ มีข้อมูลที่ต้องการดังนี้

${sections.join('\n\n')}

กรุณาส่งข้อมูลกลับมาเพื่อดำเนินการส่ง FC เข้าระบบ E-Ordering และจะแจ้งเลข FC No. กลับให้ทันทีค่ะ

ขอบคุณค่ะ
Inside Sales`
}

export async function GET() {
  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id, company_name, customer_name, coordinator_name, created_at,
      batches(batch_code, email_from),
      field_validations(field_name, status, ai_note)
    `)
    .eq('ai_status', 'missing')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emails = (orders ?? []).flatMap((o: any) => {
    const fvs: { field_name: string; status: string }[] =
      Array.isArray(o.field_validations) ? o.field_validations : []

    const missingRequired = fvs
      .filter(f => f.status === 'missing' && REQUIRED_FIELDS.has(f.field_name))
      .map(f => f.field_name)

    if (missingRequired.length === 0) return []

    const company   = o.company_name ?? o.customer_name ?? '(ไม่ระบุ)'
    const ae        = o.coordinator_name ?? ''
    const aeEmail   = o.batches?.email_from ?? ''
    const batchCode = o.batches?.batch_code ?? ''

    // Dedupe lat+lng into one GPS purpose for display
    const displayMissing = missingRequired.filter(
      (f, _i, arr) => f !== 'longitude' || !arr.includes('latitude')
    )
    const purposes = [...new Set(displayMissing.map(toPurpose))]
    const missingLabels = displayMissing.map(f =>
      f === 'latitude' ? 'พิกัด GPS' : (FIELD_LABELS[f] ?? f)
    )

    return [{
      order_id:       o.id,
      batch_code:     batchCode,
      ae_email:       aeEmail,
      company,
      ae,
      created_at:     o.created_at,
      missing_fields: missingRequired,
      purposes,
      subject:  `ขอข้อมูลเพิ่มเติม – ${missingLabels.join(', ')} (${company})`,
      body:     buildEmailBody(company, ae, missingRequired),
    }]
  })

  // Count by purpose across all orders
  const byPurpose: Record<string, number> = {}
  for (const e of emails) {
    for (const p of e.purposes) {
      byPurpose[p] = (byPurpose[p] ?? 0) + 1
    }
  }

  // Build one consolidated email draft per batch
  const batchMap = new Map<string, {
    batch_code: string
    ae_email: string
    ae: string
    byPurpose: Record<string, Array<{ company: string; missing: string[] }>>
  }>()

  for (const e of emails) {
    if (!batchMap.has(e.batch_code)) {
      batchMap.set(e.batch_code, {
        batch_code: e.batch_code,
        ae_email:   e.ae_email,
        ae:         e.ae,
        byPurpose:  {},
      })
    }
    const b = batchMap.get(e.batch_code)!
    for (const p of e.purposes) {
      if (!b.byPurpose[p]) b.byPurpose[p] = []
      b.byPurpose[p].push({ company: e.company, missing: e.missing_fields })
    }
  }

  const batchEmails = Array.from(batchMap.values()).map(b => {
    const purposeSummary = Object.entries(b.byPurpose)
      .map(([p, items]) => `${p} (${items.length})`)
      .join(' · ')
    return {
      batch_code:     b.batch_code,
      ae_email:       b.ae_email,
      ae:             b.ae,
      purposes:       Object.keys(b.byPurpose),
      purposeSummary,
      total_orders:   Object.values(b.byPurpose).flat().length,
      subject:        `ขอข้อมูลเพิ่มเติม batch ${b.batch_code} – ${purposeSummary}`,
      body:           buildConsolidatedBody(b.batch_code, b.ae, b.byPurpose),
    }
  })

  return NextResponse.json({ emails, batchEmails, byPurpose, total: emails.length })
}
