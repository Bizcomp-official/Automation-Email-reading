'use client'

import { useState, useCallback } from 'react'
import type { Order, Address, FieldValidation } from '@fc/shared'
import * as XLSX from 'xlsx'

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldSource = 'excel' | 'email' | 'address' | 'ai'
type FieldStatus = 'ok' | 'mismatch' | 'edited' | 'missing' | 'aiguess'
type CompanyStatus = 'ต้องตรวจ' | 'รอ AE' | 'พร้อมส่ง' | 'ส่งแล้ว'

interface RichField {
  key: string
  label: string
  value: string
  source: FieldSource | null
  status: FieldStatus
  note: string
  confidence: number | null
  required: boolean
}

interface CircuitData {
  idx: number
  orderId: string
  company: string
  ae: string
  companyStatus: CompanyStatus
  aeSentAt: string | null
  customerFields: RichField[]
  addressFields: RichField[]
  combinedAddress: string
  customerNote: string | null
}

type RichOrder = Order & { addresses?: Address | Address[]; field_validations?: FieldValidation[] }

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_KEYS = new Set(['circuit_order_type', 'product_package', 'speed', 'coordinator_name', 'coordinator_phone'])

const CUSTOMER_FIELD_DEFS: { key: string; label: string; required: boolean }[] = [
  { key: 'customer_name',      label: 'ชื่อลูกค้า',    required: false },
  { key: 'company_name',       label: 'บริษัท',          required: false },
  { key: 'circuit_order_type', label: 'ประเภทวงจร',     required: true  },
  { key: 'old_circuit',        label: 'วงจรเดิม',        required: false },
  { key: 'product_package',    label: 'แพ็กเกจ',         required: true  },
  { key: 'speed',              label: 'ความเร็ว',         required: true  },
  { key: 'store_code',         label: 'รหัสร้าน',        required: false },
  { key: 'branch_name',        label: 'ชื่อสาขา',        required: false },
  { key: 'coordinator_name',   label: 'ผู้ประสานงาน',   required: true  },
  { key: 'coordinator_phone',  label: 'เบอร์ติดต่อ',    required: true  },
]

const ADDRESS_FIELD_DEFS: { key: string; label: string; optional?: boolean; required?: boolean }[] = [
  { key: 'house_no',    label: 'บ้านเลขที่' },
  { key: 'moo',         label: 'หมู่ที่',            optional: true },
  { key: 'building',    label: 'อาคาร/หมู่บ้าน',   optional: true },
  { key: 'floor',       label: 'ชั้น',               optional: true },
  { key: 'room',        label: 'ห้อง',               optional: true },
  { key: 'soi',         label: 'ซอย',               optional: true },
  { key: 'road',        label: 'ถนน' },
  { key: 'subdistrict', label: 'แขวง/ตำบล' },
  { key: 'district',    label: 'เขต/อำเภอ' },
  { key: 'province',    label: 'จังหวัด' },
  { key: 'postcode',    label: 'รหัสไปรษณีย์' },
  { key: 'latitude',    label: 'ละติจูด',   required: true },
  { key: 'longitude',   label: 'ลองจิจูด',  required: true },
]

const ADDR_SPLIT_KEYS = new Set(['house_no','moo','building','floor','room','soi','road','subdistrict','district','province','postcode'])

const SOURCE_LABELS: Record<FieldSource, { label: string; cls: string }> = {
  excel:   { label: 'Excel',           cls: 'text-emerald-700' },
  email:   { label: 'อีเมล',           cls: 'text-blue-700' },
  address: { label: 'แยกจาก address',  cls: 'text-cyan-700' },
  ai:      { label: 'AI',              cls: 'text-amber-700' },
}

const STATUS_CFG: Record<FieldStatus, { label: string; cls: string; icon?: string }> = {
  ok:       { label: 'ถูกต้อง',  cls: 'bg-teal-50 text-teal-700 ring-teal-200' },
  mismatch: { label: 'ไม่ตรง',   cls: 'bg-amber-50 text-amber-700 ring-amber-200', icon: '⚠' },
  edited:   { label: 'แก้แล้ว',  cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  missing:  { label: 'ต้องกรอก', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
  aiguess:  { label: 'AI',       cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
}

const COMPANY_STATUS_CFG: Record<CompanyStatus, string> = {
  'ต้องตรวจ': 'bg-amber-50 text-amber-800 ring-amber-200',
  'รอ AE':    'bg-rose-50 text-rose-800 ring-rose-200',
  'พร้อมส่ง': 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  'ส่งแล้ว':  'bg-slate-100 text-slate-600 ring-slate-200',
}

const DOT_COLOR: Record<CompanyStatus, string> = {
  'ต้องตรวจ': 'bg-amber-400',
  'รอ AE':    'bg-rose-400',
  'พร้อมส่ง': 'bg-emerald-400',
  'ส่งแล้ว':  'bg-slate-300',
}

// ── Data helpers ───────────────────────────────────────────────────────────────

function unwrapAddr(order: RichOrder): Address | undefined {
  return Array.isArray(order.addresses) ? order.addresses[0] : order.addresses
}

function unwrapFv(order: RichOrder): FieldValidation[] {
  return Array.isArray(order.field_validations) ? order.field_validations : []
}

function mapStatus(vs: string | null | undefined, required: boolean, hasValue: boolean): FieldStatus {
  if (!hasValue) return required ? 'missing' : 'missing'
  switch (vs) {
    case 'correct':   return 'ok'
    case 'missing':   return required ? 'missing' : 'missing'
    case 'suspicious':
    case 'incorrect': return 'mismatch'
    case 'suggested': return 'aiguess'
    default:          return 'ok'
  }
}

function inferSource(key: string, fvStatus: string | null | undefined, sourceRef: string | null): FieldSource | null {
  if (fvStatus === 'suggested') return 'ai'
  if (ADDR_SPLIT_KEYS.has(key)) return 'address'
  if (sourceRef?.toLowerCase().includes('excel')) return 'excel'
  return 'email'
}

function buildCombined(addr: Address | undefined): string {
  if (!addr) return ''
  const p: string[] = []
  if (addr.house_no) p.push(addr.house_no)
  if (addr.moo) p.push(`หมู่ ${addr.moo}`)
  if (addr.building) p.push(addr.building)
  if (addr.floor) p.push(`ชั้น ${addr.floor}`)
  if (addr.room) p.push(`ห้อง ${addr.room}`)
  if (addr.soi) p.push(`ซอย ${addr.soi}`)
  if (addr.road) p.push(`ถนน ${addr.road}`)
  if (addr.subdistrict) p.push(addr.subdistrict)
  if (addr.district) p.push(addr.district)
  if (addr.province) p.push(addr.province)
  if (addr.postcode) p.push(addr.postcode)
  return p.join(' ')
}

function buildCombinedFromFields(addrFields: RichField[]): string {
  const g = (k: string) => addrFields.find(f => f.key === k)?.value ?? ''
  const p: string[] = []
  if (g('house_no'))    p.push(g('house_no'))
  if (g('moo'))         p.push(`หมู่ ${g('moo')}`)
  if (g('building'))    p.push(g('building'))
  if (g('floor'))       p.push(`ชั้น ${g('floor')}`)
  if (g('room'))        p.push(`ห้อง ${g('room')}`)
  if (g('soi'))         p.push(`ซอย ${g('soi')}`)
  if (g('road'))        p.push(`ถนน ${g('road')}`)
  if (g('subdistrict')) p.push(g('subdistrict'))
  if (g('district'))    p.push(g('district'))
  if (g('province'))    p.push(g('province'))
  if (g('postcode'))    p.push(g('postcode'))
  return p.join(' ')
}

function deriveCompanyStatus(customerFields: RichField[], addressFields: RichField[]): CompanyStatus {
  const all = [...customerFields, ...addressFields]
  if (all.some(f => f.required && f.status === 'missing')) return 'รอ AE'
  if (all.some(f => f.status === 'mismatch' || f.status === 'aiguess')) return 'ต้องตรวจ'
  return 'พร้อมส่ง'
}

function buildCircuits(orders: RichOrder[]): CircuitData[] {
  return orders.map((order, idx) => {
    const fvs = unwrapFv(order)
    const addr = unwrapAddr(order)
    const fvMap = Object.fromEntries(fvs.map(f => [f.field_name, f]))
    const sourceRef = order.source_ref

    const getOrderVal = (key: string): string => {
      const v = (order as unknown as Record<string, unknown>)[key]
      return v != null ? String(v) : ''
    }

    const customerFields: RichField[] = CUSTOMER_FIELD_DEFS.map(def => {
      const fv = fvMap[def.key]
      const value = (fv?.value ?? getOrderVal(def.key)).trim()
      const hasValue = value.length > 0
      return {
        key: def.key,
        label: def.label,
        value,
        source: hasValue ? inferSource(def.key, fv?.status, sourceRef) : null,
        status: mapStatus(fv?.status, def.required, hasValue),
        note: fv?.ai_note ?? '',
        confidence: fv?.confidence ?? null,
        required: def.required,
      }
    })

    const addrVal = (key: string): string => {
      const v = addr?.[key as keyof Address]
      return v != null ? String(v) : ''
    }

    const addressFields: RichField[] = ADDRESS_FIELD_DEFS.map(def => {
      const fv = fvMap[def.key]
      const value = (fv?.value ?? addrVal(def.key)).trim()
      const hasValue = value.length > 0
      // lat/lng marked "correct" with office note = office site, treat as not required
      const isOfficeLat = (def.key === 'latitude' || def.key === 'longitude')
        && fv?.status === 'correct'
        && fv?.ai_note?.includes('สำนักงาน')
      const required = !!def.required && !isOfficeLat
      return {
        key: def.key,
        label: def.label,
        value,
        source: hasValue ? (fv?.status === 'suggested' ? 'ai' : 'address') : null,
        status: mapStatus(fv?.status, required, hasValue),
        note: fv?.ai_note ?? '',
        confidence: fv?.confidence ?? null,
        required,
      }
    })

    return {
      idx,
      orderId: order.id,
      company: order.company_name ?? order.customer_name ?? `วงจร ${idx + 1}`,
      ae: order.coordinator_name ?? '',
      companyStatus: deriveCompanyStatus(customerFields, addressFields),
      aeSentAt: null,
      customerFields,
      addressFields,
      combinedAddress: buildCombined(addr),
      customerNote: order.customer_note ?? null,
    }
  })
}

// ── Small render helpers ───────────────────────────────────────────────────────

function SourceBadge({ source }: { source: FieldSource | null }) {
  if (!source) return <span className="text-gray-300 text-xs">—</span>
  const { label, cls } = SOURCE_LABELS[source]
  return <span className={`text-xs font-medium ${cls}`}>ที่มา · {label}</span>
}

function StatusPill({ status }: { status: FieldStatus }) {
  const { label, cls, icon } = STATUS_CFG[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${cls}`}>
      {icon && <span>{icon}</span>}
      {label}
    </span>
  )
}

function CompanyStatusPill({ status }: { status: CompanyStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${COMPANY_STATUS_CFG[status]}`}>
      {status}
    </span>
  )
}

function ConfidenceText({ conf }: { conf: number | null }) {
  if (conf === null) return <span className="text-gray-300 text-xs">—</span>
  const pct = Math.round(conf * 100)
  const cls = pct >= 85 ? 'text-emerald-700' : pct >= 60 ? 'text-amber-700' : 'text-rose-700'
  return <span className={`text-xs font-semibold ${cls}`}>{pct}%</span>
}

function AiNote({ note }: { note: string }) {
  if (!note) return <span className="text-gray-300 text-xs">—</span>
  return (
    <span className="inline-flex items-start gap-1 bg-sky-50 text-sky-800 text-xs rounded-md px-2 py-1 leading-snug">
      <span className="mt-0.5 flex-shrink-0">✦</span>
      <span>AI คิดจาก: {note}</span>
    </span>
  )
}

// ── Key / Legend box ──────────────────────────────────────────────────────────

function KeyBox() {
  const statusDescs: Record<FieldStatus, string> = {
    ok:       'ตรวจกับตารางที่อยู่แล้ว ตรงกัน',
    mismatch: 'ขัดกับตาราง/พิกัด → ต้อง recheck',
    edited:   'คนแก้ด้วยมือ',
    missing:  'จำเป็นแต่ยังว่าง → email AE',
    aiguess:  'AI เดา ยังไม่ยืนยันกับตาราง',
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">คำอธิบายสัญลักษณ์</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2.5">ที่มา (source)</p>
          <div className="space-y-2">
            {(Object.entries(SOURCE_LABELS) as [FieldSource, typeof SOURCE_LABELS[FieldSource]][]).map(([key, { label, cls }]) => {
              const descs: Record<FieldSource, string> = {
                excel:   'จากไฟล์ Excel / ระบบ Vcare — เชื่อถือได้',
                email:   'ระบุตรงๆ ในเนื้ออีเมล',
                address: 'AI แยกจากที่อยู่เต็ม (ยังมาจากอีเมล)',
                ai:      'AI อนุมานเอง ไม่มีในอีเมล',
              }
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className={`text-xs font-medium whitespace-nowrap ${cls}`}>ที่มา · {label}</span>
                  <span className="text-xs text-gray-400">— {descs[key]}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2.5">สถานะ (status)</p>
          <div className="space-y-2">
            {(Object.entries(STATUS_CFG) as [FieldStatus, typeof STATUS_CFG[FieldStatus]][]).map(([key, { label, cls, icon }]) => (
              <div key={key} className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 whitespace-nowrap ${cls}`}>
                  {icon && <span>{icon}</span>}
                  {label}
                </span>
                <span className="text-xs text-gray-400">— {statusDescs[key]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inline editable value cell ────────────────────────────────────────────────

function EditableCell({ field, onSave }: { field: RichField; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.value)

  const commit = () => {
    setEditing(false)
    onSave(draft.trim())
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(field.value); setEditing(false) }
        }}
        className="w-full min-w-28 text-sm border border-[#185FA5] rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-[#185FA5]/30"
      />
    )
  }

  if (field.status === 'missing' && !field.value) {
    return (
      <button onClick={() => { setDraft(''); setEditing(true) }} className="text-xs text-rose-600 font-medium italic hover:underline text-left">
        required — missing
      </button>
    )
  }

  return (
    <button
      onClick={() => { setDraft(field.value); setEditing(true) }}
      className="text-left text-sm text-gray-900 hover:bg-blue-50 rounded px-1 -mx-1 w-full transition-colors"
    >
      {field.value || <span className="text-gray-300">—</span>}
    </button>
  )
}

// ── Field detail table ─────────────────────────────────────────────────────────

function DetailTable({ fields, onSaveField }: { fields: RichField[]; onSaveField: (key: string, v: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 border-b border-gray-100">
          <th className="text-left px-4 py-2 font-medium w-40">ฟิลด์</th>
          <th className="text-left px-4 py-2 font-medium">ค่า</th>
          <th className="text-left px-4 py-2 font-medium w-36">ที่มา</th>
          <th className="text-left px-4 py-2 font-medium w-28">สถานะ</th>
          <th className="text-left px-4 py-2 font-medium">หมายเหตุ AI</th>
          <th className="text-right px-4 py-2 font-medium w-20">ความมั่นใจ</th>
        </tr>
      </thead>
      <tbody>
        {fields.map(f => (
          <tr key={f.key} className="border-b border-gray-50 last:border-0">
            <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
              {f.label}{f.required && <span className="text-rose-500 ml-0.5">*</span>}
            </td>
            <td className="px-4 py-2.5">
              <EditableCell field={f} onSave={v => onSaveField(f.key, v)} />
            </td>
            <td className="px-4 py-2.5"><SourceBadge source={f.source} /></td>
            <td className="px-4 py-2.5"><StatusPill status={f.status} /></td>
            <td className="px-4 py-2.5 max-w-xs"><AiNote note={f.note} /></td>
            <td className="px-4 py-2.5 text-right"><ConfidenceText conf={f.confidence} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Build consolidated AE email for all รอ AE circuits ────────────────────────

function buildConsolidatedEmail(aeCircuits: CircuitData[], aeEmail: string) {
  const ae = aeCircuits[0]?.ae || '[ชื่อ AE]'

  const siteBlocks = aeCircuits.map((c, i) => {
    const missing = [...c.customerFields, ...c.addressFields].filter(f => f.required && f.status === 'missing')
    const hasGps = missing.some(f => f.key === 'latitude' || f.key === 'longitude')
    const others = missing.filter(f => f.key !== 'latitude' && f.key !== 'longitude')
    const lines = [
      ...others.map(f => `  • ${f.label}`),
      ...(hasGps ? ['  • พิกัด GPS (ละติจูด / ลองจิจูด) — กรุณาแชร์ลิงก์ Google Maps หรือระบุค่าพิกัดของสถานที่ติดตั้ง'] : []),
    ]
    return `【 Site ${i + 1} 】 ${c.company}\n${lines.join('\n')}`
  })

  const subject = `ขอข้อมูลเพิ่มเติม FC – ${aeCircuits.length} sites (${aeCircuits.map(c => c.company).join(', ')})`
  const body = `เรียน ${ae},
รบกวนขอข้อมูลเพิ่มเติมสำหรับ FC จำนวน ${aeCircuits.length} sites ค่ะ เนื่องจากข้อมูลด้านล่างเป็นข้อมูลจำเป็น (required) ที่ต้องกรอกใน Check Fact ก่อนส่งเข้าระบบ E-Ordering

${siteBlocks.join('\n\n')}

กรุณาส่งข้อมูลกลับมาเพื่อดำเนินการส่ง FC เข้าระบบและจะแจ้งเลข FC No. กลับให้ทันทีค่ะ

ขอบคุณค่ะ
Inside Sales`

  return { subject, body, aeEmail }
}

// ── Consolidated email button (shown instead of Export when รอ AE exists) ──────

function ConsolidatedEmailButton({ aeCircuits, aeEmail }: { aeCircuits: CircuitData[]; aeEmail: string }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const { subject, body } = buildConsolidatedEmail(aeCircuits, aeEmail)

  const handleSend = () => {
    window.open(`mailto:${encodeURIComponent(aeEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
    setSent(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 text-sm font-medium hover:bg-rose-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          {open ? 'ซ่อนอีเมล' : 'ดูอีเมล'}
          <span className="text-xs bg-rose-200 text-rose-800 px-1.5 py-0.5 rounded-full font-semibold">{aeCircuits.length} sites</span>
          {sent && <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full">ส่งแล้ว</span>}
        </button>
      </div>

      {open && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 space-y-3">
          <div className="bg-white rounded-lg border border-rose-100 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-gray-600">ถึง:</span>
              <span className="text-gray-800">{aeEmail || '(ไม่มีอีเมล AE)'}</span>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="font-medium text-gray-600 flex-shrink-0">Subject:</span>
              <span className="text-gray-800">{subject}</span>
            </div>
            <div className="border-t border-gray-100 pt-2">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{body}</pre>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSend}
              className="text-sm px-4 py-2 rounded-lg bg-rose-700 text-white hover:bg-rose-800 transition-colors"
            >
              {sent ? 'ส่งซ้ำ' : 'เปิดอีเมล'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AE email request box (per-circuit, shown in detail view) ──────────────────

function AeEmailBox({ circuit }: { circuit: CircuitData }) {
  const missing = [...circuit.customerFields, ...circuit.addressFields].filter(f => f.required && f.status === 'missing')
  if (missing.length === 0) return null

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
      <p className="text-sm font-semibold text-rose-800">รอ AE — {missing.length} ฟิลด์ขาด</p>
      <p className="text-xs text-rose-600 mt-0.5">{missing.map(f => f.label).join(' · ')}</p>
      {circuit.aeSentAt && (
        <p className="text-xs text-rose-400 mt-1">ส่งแล้วเมื่อ {circuit.aeSentAt}</p>
      )}
    </div>
  )
}

// ── Circuit detail view ───────────────────────────────────────────────────────

function downloadJson(circuits: CircuitData[]) {
  const payload = circuits.map(c => ({
    company: c.company,
    order_type: c.customerFields.find(f => f.key === 'circuit_order_type')?.value ?? '',
    package: c.customerFields.find(f => f.key === 'product_package')?.value ?? '',
    speed: c.customerFields.find(f => f.key === 'speed')?.value ?? '',
    coordinator: c.customerFields.find(f => f.key === 'coordinator_name')?.value ?? '',
    phone: c.customerFields.find(f => f.key === 'coordinator_phone')?.value ?? '',
    address: c.combinedAddress,
    subdistrict: c.addressFields.find(f => f.key === 'subdistrict')?.value ?? '',
    district: c.addressFields.find(f => f.key === 'district')?.value ?? '',
    province: c.addressFields.find(f => f.key === 'province')?.value ?? '',
    postcode: c.addressFields.find(f => f.key === 'postcode')?.value ?? '',
    lat: c.addressFields.find(f => f.key === 'latitude')?.value ?? '',
    long: c.addressFields.find(f => f.key === 'longitude')?.value ?? '',
    status: c.companyStatus,
  }))
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'FC_payload.json'; a.click()
  URL.revokeObjectURL(url)
}

function CircuitDetailView({
  circuit,
  onSaveField,
  onAeSent,
  allCircuits,
  aeEmail,
}: {
  circuit: CircuitData
  onSaveField: (key: string, value: string) => void
  onAeSent: () => void
  allCircuits: CircuitData[]
  aeEmail?: string
}) {
  const aeCircuits = allCircuits.filter(c => c.companyStatus === 'รอ AE')
  const visibleAddr = circuit.addressFields.filter(f => {
    if (!f.key.match(/^(moo|building|floor|room|soi)$/)) return true
    return f.value.trim().length > 0
  })

  const exportExcel = () => {
    const rows: (string | number)[][] = [
      ['ฟิลด์', 'ค่า', 'ที่มา', 'สถานะ', 'หมายเหตุ AI', 'ความมั่นใจ %'],
      ...circuit.customerFields.map(f => [
        f.label + (f.required ? ' *' : ''),
        f.value,
        f.source ? SOURCE_LABELS[f.source].label : '',
        STATUS_CFG[f.status].label,
        f.note,
        f.confidence != null ? Math.round(f.confidence * 100) : '',
      ]),
      ['สถานที่ติดตั้ง (รวม)', circuit.combinedAddress, 'อีเมล', 'ถูกต้อง', '', ''],
      ...visibleAddr.map(f => [
        f.label,
        f.value,
        f.source ? SOURCE_LABELS[f.source].label : '',
        STATUS_CFG[f.status].label,
        f.note,
        f.confidence != null ? Math.round(f.confidence * 100) : '',
      ]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, circuit.company.slice(0, 30))
    XLSX.writeFile(wb, `FC_${circuit.company}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {circuit.customerNote && (
        <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <span className="text-amber-500 flex-shrink-0 mt-0.5">✏</span>
          <div>
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">หมายเหตุจากผู้ส่ง</p>
            <p className="text-sm text-amber-900 leading-relaxed">{circuit.customerNote}</p>
          </div>
        </div>
      )}

      <AeEmailBox circuit={circuit} />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ข้อมูลลูกค้า / วงจร</h3>
        </div>
        <DetailTable fields={circuit.customerFields} onSaveField={onSaveField} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ที่อยู่ปลายทาง</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="text-left px-4 py-2 font-medium w-40">ฟิลด์</th>
              <th className="text-left px-4 py-2 font-medium">ค่า</th>
              <th className="text-left px-4 py-2 font-medium w-36">ที่มา</th>
              <th className="text-left px-4 py-2 font-medium w-28">สถานะ</th>
              <th className="text-left px-4 py-2 font-medium">หมายเหตุ AI</th>
              <th className="text-right px-4 py-2 font-medium w-20">ความมั่นใจ</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-50">
              <td className="px-4 py-2.5 text-gray-600 font-medium whitespace-nowrap">สถานที่ติดตั้ง (รวม)</td>
              <td className="px-4 py-2.5 text-gray-900">{circuit.combinedAddress || <span className="text-gray-300">—</span>}</td>
              <td className="px-4 py-2.5"><SourceBadge source="email" /></td>
              <td className="px-4 py-2.5"><StatusPill status="ok" /></td>
              <td className="px-4 py-2.5 text-gray-300 text-xs">—</td>
              <td />
            </tr>
            <tr className="border-b border-gray-100">
              <td colSpan={6} className="px-4 py-1.5">
                <span className="text-xs text-cyan-600 font-medium">↳ AI แยก address รวม → fields ด้านล่าง</span>
              </td>
            </tr>
            {visibleAddr.map(f => (
              <tr key={f.key} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 text-gray-500 pl-8 whitespace-nowrap">{f.label}</td>
                <td className="px-4 py-2.5">
                  <EditableCell field={f} onSave={v => onSaveField(f.key, v)} />
                </td>
                <td className="px-4 py-2.5"><SourceBadge source={f.source} /></td>
                <td className="px-4 py-2.5"><StatusPill status={f.status} /></td>
                <td className="px-4 py-2.5 max-w-xs"><AiNote note={f.note} /></td>
                <td className="px-4 py-2.5 text-right"><ConfidenceText conf={f.confidence} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 pt-1">
        {aeCircuits.length > 0 ? (
          <ConsolidatedEmailButton aeCircuits={aeCircuits} aeEmail={aeEmail ?? ''} />
        ) : (
          <>
            <button onClick={exportExcel} className="px-4 py-2 rounded-lg bg-[#185FA5] text-white text-sm font-medium hover:bg-[#145090] transition-colors">
              ส่งออก Excel
            </button>
            <button onClick={() => downloadJson(allCircuits)} className="text-xs text-slate-300 hover:text-slate-500 transition-colors">
              JSON
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Excel grid view ───────────────────────────────────────────────────────────

const EXCEL_COLS: { key: string; label: string }[] = [
  { key: 'status',             label: 'สถานะ' },
  { key: 'company_name',       label: 'บริษัท' },
  { key: 'circuit_order_type', label: 'ประเภทวงจร' },
  { key: 'old_circuit',        label: 'วงจรเดิม' },
  { key: 'product_package',    label: 'Product Package' },
  { key: 'speed',              label: 'Speed' },
  { key: 'store_code',         label: 'รหัสร้าน' },
  { key: 'branch_name',        label: 'ชื่อสาขา' },
  { key: 'coordinator_name',   label: 'ผู้ประสานงาน' },
  { key: 'coordinator_phone',  label: 'เบอร์ติดต่อ' },
  { key: 'combined_address',   label: 'สถานที่ติดตั้ง' },
  { key: 'house_no',           label: 'บ้านเลขที่' },
  { key: 'soi',                label: 'ซอย' },
  { key: 'road',               label: 'ถนน' },
  { key: 'subdistrict',        label: 'แขวง/ตำบล' },
  { key: 'district',           label: 'เขต/อำเภอ' },
  { key: 'province',           label: 'จังหวัด' },
  { key: 'postcode',           label: 'รหัสไปรษณีย์' },
  { key: 'latitude',           label: 'Latitude' },
  { key: 'longitude',          label: 'Longitude' },
]

function getExcelCell(c: CircuitData, key: string): { value: string; missing: boolean } {
  if (key === 'status') return { value: c.companyStatus, missing: false }
  if (key === 'combined_address') return { value: c.combinedAddress, missing: false }
  const cf = c.customerFields.find(f => f.key === key)
  if (cf) return { value: cf.value, missing: REQUIRED_KEYS.has(key) && !cf.value }
  const af = c.addressFields.find(f => f.key === key)
  if (af) return { value: af.value, missing: false }
  return { value: '', missing: false }
}

function ExcelGridView({ circuits, allCircuits, aeEmail }: { circuits: CircuitData[]; allCircuits: CircuitData[]; aeEmail: string }) {
  const aeCircuits = allCircuits.filter(c => c.companyStatus === 'รอ AE')

  const downloadXlsx = () => {
    const header = EXCEL_COLS.map(c => c.label)
    const rows = circuits.map(c => EXCEL_COLS.map(col => getExcelCell(c, col.key).value))
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'FC Export')
    XLSX.writeFile(wb, 'FC_export.xlsx')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {aeCircuits.length > 0 ? (
          <ConsolidatedEmailButton aeCircuits={aeCircuits} aeEmail={aeEmail} />
        ) : (
          <>
            <button onClick={downloadXlsx} className="px-4 py-2 rounded-lg bg-[#185FA5] text-white text-sm font-medium hover:bg-[#145090] transition-colors">
              ดาวน์โหลด Excel
            </button>
            <button onClick={() => downloadJson(allCircuits)} className="text-xs text-slate-300 hover:text-slate-500 transition-colors">
              JSON
            </button>
          </>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="text-sm border-collapse" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 border-r border-gray-200 whitespace-nowrap sticky left-0 bg-gray-50 z-10">#</th>
              {EXCEL_COLS.map(col => (
                <th key={col.key} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 border-r border-gray-100 whitespace-nowrap last:border-r-0">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {circuits.map((c, i) => (
              <tr key={c.orderId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                <td className="px-3 py-2.5 text-xs text-gray-400 font-mono border-r border-gray-100 sticky left-0 bg-white">{i + 1}</td>
                {EXCEL_COLS.map(col => {
                  if (col.key === 'status') {
                    return (
                      <td key={col.key} className="px-3 py-2.5 border-r border-gray-100 last:border-0">
                        <CompanyStatusPill status={c.companyStatus} />
                      </td>
                    )
                  }
                  const { value, missing } = getExcelCell(c, col.key)
                  return (
                    <td key={col.key} className={`px-3 py-2.5 whitespace-nowrap text-xs border-r border-gray-100 last:border-0 ${missing ? 'bg-rose-50' : ''}`}>
                      {value
                        ? <span className={missing ? 'text-rose-600 font-medium' : 'text-gray-800'}>{value}</span>
                        : <span className={missing ? 'text-rose-400 italic' : 'text-gray-300'}>—</span>
                      }
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

type FilterChip = 'ทั้งหมด' | 'ต้องตรวจ' | 'รอ AE' | 'พร้อมส่ง'

export default function ExtractionTab({
  orders,
  aeEmail,
  onSelectOrder,
}: {
  orders: RichOrder[]
  aeEmail?: string
  onSelectOrder: (idx: number) => void
}) {
  const [circuits, setCircuits] = useState<CircuitData[]>(() => buildCircuits(orders))
  const [activeTab, setActiveTab] = useState<'grid' | number>('grid')
  const [filter, setFilter] = useState<FilterChip>('ทั้งหมด')

  const saveField = useCallback((circuitIdx: number, key: string, newValue: string) => {
    setCircuits(prev => prev.map((c, i) => {
      if (i !== circuitIdx) return c
      const updateFields = (fields: RichField[]): RichField[] =>
        fields.map(f => {
          if (f.key !== key) return f
          const isEmpty = !newValue.trim()
          return {
            ...f,
            value: newValue,
            status: isEmpty && f.required ? 'missing' : (newValue !== f.value ? 'edited' : f.status),
            note: '',
          }
        })
      const newCustomer = updateFields(c.customerFields)
      const newAddress = updateFields(c.addressFields)
      const addrKeySet = new Set(ADDRESS_FIELD_DEFS.map(d => d.key))
      const newCombined = addrKeySet.has(key) ? buildCombinedFromFields(newAddress) : c.combinedAddress
      return {
        ...c,
        customerFields: newCustomer,
        addressFields: newAddress,
        combinedAddress: newCombined,
        companyStatus: deriveCompanyStatus(newCustomer, newAddress),
      }
    }))
  }, [])

  const markAeSent = useCallback((circuitIdx: number) => {
    setCircuits(prev => prev.map((c, i) =>
      i !== circuitIdx ? c : { ...c, aeSentAt: new Date().toLocaleString('th-TH'), companyStatus: 'รอ AE' }
    ))
  }, [])

  const counts: Record<FilterChip, number> = {
    'ทั้งหมด':  circuits.length,
    'ต้องตรวจ': circuits.filter(c => c.companyStatus === 'ต้องตรวจ').length,
    'รอ AE':    circuits.filter(c => c.companyStatus === 'รอ AE').length,
    'พร้อมส่ง': circuits.filter(c => c.companyStatus === 'พร้อมส่ง').length,
  }

  const visibleCircuits = filter === 'ทั้งหมด' ? circuits : circuits.filter(c => c.companyStatus === filter)
  const companyCount = new Set(circuits.map(c => c.company)).size
  const activeCircuit = typeof activeTab === 'number' ? circuits[activeTab] : null

  return (
    <div className="space-y-5">
      {/* Header: counts + filter chips */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-600">
          ตรวจพบ <span className="font-semibold text-gray-900">{circuits.length}</span> วงจร
          {' · '}
          <span className="font-semibold text-gray-900">{companyCount}</span> บริษัท
        </p>
        <div className="flex gap-2 flex-wrap">
          {(['ทั้งหมด', 'ต้องตรวจ', 'รอ AE', 'พร้อมส่ง'] as FilterChip[]).map(chip => (
            <button
              key={chip}
              onClick={() => { setFilter(chip); setActiveTab('grid') }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filter === chip
                  ? 'bg-[#185FA5] text-white border-[#185FA5]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#185FA5]'
              }`}
            >
              {chip} ({counts[chip]})
            </button>
          ))}
        </div>
      </div>

      {/* Key box */}
      <KeyBox />

      {/* Circuit tab strip */}
      <div className="border-b border-gray-200 -mb-5">
        <div className="flex overflow-x-auto">
          <button
            onClick={() => setActiveTab('grid')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors -mb-px flex-shrink-0 ${
              activeTab === 'grid' ? 'border-[#185FA5] text-[#185FA5]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18M14 3v18" />
            </svg>
            ทุกวงจร
          </button>
          {visibleCircuits.map(c => (
            <button
              key={c.orderId}
              onClick={() => { setActiveTab(c.idx); onSelectOrder(c.idx) }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors -mb-px flex-shrink-0 ${
                activeTab === c.idx ? 'border-[#185FA5] text-[#185FA5]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT_COLOR[c.companyStatus]}`} />
              วงจร {c.idx + 1} · {c.company}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-5">
        {activeTab === 'grid' ? (
          <ExcelGridView circuits={visibleCircuits} allCircuits={circuits} aeEmail={aeEmail ?? ''} />
        ) : activeCircuit ? (
          <CircuitDetailView
            circuit={activeCircuit}
            onSaveField={(key, value) => saveField(activeCircuit.idx, key, value)}
            onAeSent={() => markAeSent(activeCircuit.idx)}
            allCircuits={circuits}
            aeEmail={aeEmail}
          />
        ) : null}
      </div>
    </div>
  )
}
