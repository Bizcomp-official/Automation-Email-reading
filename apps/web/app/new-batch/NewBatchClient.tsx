'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { Batch, Order, FieldValidation, Address, ValidationStatus } from '@fc/shared'
import { uploadBatch } from '@/lib/api'
import { AiStatusBadge, ValidationStatusBadge } from '../components/StatusBadge'
import MapPreview from '../components/MapPreview'

type Tab = 'upload' | 'extraction' | 'geolocation'
const STORAGE_KEY = 'fc-current-batch'

// ── Column definitions ────────────────────────────────────────────────────────

const INFO_COLS = [
  { key: 'customer_name',      label: 'ชื่อลูกค้า' },
  { key: 'company_name',       label: 'บริษัท' },
  { key: 'circuit_order_type', label: 'ประเภทวงจร' },
  { key: 'product_package',    label: 'แพ็คเกจ' },
  { key: 'speed',              label: 'ความเร็ว' },
  { key: 'store_code',         label: 'รหัสสาขา' },
  { key: 'branch_name',        label: 'ชื่อสาขา' },
  { key: 'coordinator_name',   label: 'ผู้ประสานงาน' },
  { key: 'coordinator_phone',  label: 'เบอร์ติดต่อ' },
]

const ADDR_COLS = [
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

const ADDR_KEYS = new Set(ADDR_COLS.map((c) => c.key))

// ── Helpers ───────────────────────────────────────────────────────────────────

type RichOrder = Order & { addresses?: Address | Address[]; field_validations?: FieldValidation[] }

function unwrapAddr(order: RichOrder): Address | undefined {
  return Array.isArray(order.addresses) ? order.addresses[0] : order.addresses
}

function unwrapFv(order: RichOrder): FieldValidation[] {
  return Array.isArray(order.field_validations) ? order.field_validations : []
}

function buildFvMap(fvs: FieldValidation[]): Record<string, FieldValidation> {
  return Object.fromEntries(fvs.map((f) => [f.field_name, f]))
}

function getFieldValue(order: RichOrder, key: string): string | null {
  if (ADDR_KEYS.has(key)) {
    const addr = unwrapAddr(order)
    const v = addr?.[key as keyof Address]
    return v != null ? String(v) : null
  }
  const v = (order as unknown as Record<string, unknown>)[key]
  return v != null ? String(v) : null
}

function cellStyle(status: ValidationStatus | undefined): string {
  switch (status) {
    case 'missing':
    case 'incorrect':  return 'bg-red-50 text-red-700'
    case 'suspicious': return 'bg-amber-50 text-amber-800'
    case 'suggested':  return 'bg-blue-50 text-blue-800'
    default:           return 'text-gray-800'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewBatchClient() {
  const [tab, setTab]                       = useState<Tab>('upload')
  const [dragging, setDragging]             = useState(false)
  const [file, setFile]                     = useState<File | null>(null)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [batch, setBatch]                   = useState<(Batch & { orders: Order[] }) | null>(null)
  const [selectedOrderIdx, setSelectedOrderIdx] = useState(0)
  const [showRaw, setShowRaw]               = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) { setBatch(JSON.parse(saved)); setTab('extraction') }
    } catch { localStorage.removeItem(STORAGE_KEY) }
  }, [])

  const saveBatch = (b: Batch & { orders: Order[] }) => {
    setBatch(b)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(b)) } catch { /* quota */ }
  }

  const clearBatch = () => {
    setBatch(null); setFile(null); setError(null)
    setSelectedOrderIdx(0); setShowRaw(false); setTab('upload')
    localStorage.removeItem(STORAGE_KEY)
  }

  const handleFile = (f: File) => {
    if (!/\.(eml|msg)$/i.test(f.name)) { setError('กรุณาเลือกไฟล์ .eml หรือ .msg เท่านั้น'); return }
    setFile(f); setError(null)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) handleFile(f)
  }, [])

  const onSubmit = async () => {
    if (!file) return
    setLoading(true); setError(null)
    try {
      const result = await uploadBatch(file)
      saveBatch(result); setSelectedOrderIdx(0); setShowRaw(false); setTab('extraction')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally { setLoading(false) }
  }

  const orders = (batch?.orders ?? []) as RichOrder[]
  const selectedOrder = orders[selectedOrderIdx]
  const address = selectedOrder ? unwrapAddr(selectedOrder) : undefined
  const fieldValidations = selectedOrder ? unwrapFv(selectedOrder) : []
  const hasNotes = orders.some((o) => (o as RichOrder & { customer_note?: string }).customer_note)

  const selectOrder = (i: number, goGeo = false) => {
    setSelectedOrderIdx(i)
    if (goGeo) setTab('geolocation')
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">New Batch</h1>
          <p className="text-sm text-gray-500 mt-1">อัปโหลดอีเมลคำสั่งติดตั้งและให้ AI วิเคราะห์ที่อยู่</p>
          {batch && (
            <p className="text-xs text-gray-400 mt-1">
              Batch: <span className="font-mono">{batch.batch_code}</span>{' · '}{batch.orders.length} คำสั่ง
            </p>
          )}
        </div>
        {batch && (
          <button
            onClick={clearBatch}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            เริ่ม Batch ใหม่
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6 gap-1">
        {(['upload', 'extraction', 'geolocation'] as Tab[]).map((t) => {
          const labels: Record<Tab, string> = { upload: 'อัปโหลด', extraction: 'ผลการวิเคราะห์', geolocation: 'ที่อยู่และพิกัด' }
          const active  = tab === t
          const enabled = t === 'upload' || !!batch
          return (
            <button
              key={t}
              onClick={() => enabled && setTab(t)}
              disabled={!enabled}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active   ? 'border-[#185FA5] text-[#185FA5]'
                : enabled ? 'border-transparent text-gray-500 hover:text-gray-700'
                : 'border-transparent text-gray-300 cursor-not-allowed'
              }`}
            >
              {labels[t]}
            </button>
          )
        })}
      </div>

      {/* ── Upload tab ── */}
      {tab === 'upload' && (
        <div className="space-y-4 max-w-2xl">
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
              dragging ? 'border-[#185FA5] bg-blue-50' : 'border-gray-300 hover:border-[#185FA5] hover:bg-gray-50'
            }`}
          >
            <input ref={fileInputRef} type="file" accept=".eml,.msg" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {file ? (
              <div>
                <p className="text-sm font-medium text-[#185FA5]">{file.name}</p>
                <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-gray-700">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก</p>
                <p className="text-xs text-gray-400 mt-1">รองรับ .eml และ .msg (สูงสุด 20MB)</p>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

          <button
            onClick={onSubmit}
            disabled={!file || loading}
            className="w-full py-3 px-6 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#185FA5' }}
          >
            {loading ? 'กำลังวิเคราะห์ด้วย AI...' : 'เริ่มอ่านด้วย AI'}
          </button>

          {batch && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-medium text-green-800">
                วิเคราะห์เสร็จแล้ว — พบ {batch.orders.length} คำสั่ง ({batch.batch_code})
              </p>
              <button onClick={() => setTab('extraction')} className="mt-2 text-xs text-green-700 underline">
                ดูผลการวิเคราะห์
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Extraction tab — spreadsheet layout ── */}
      {tab === 'extraction' && batch && (
        <div className="space-y-4">

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <span className="font-medium text-gray-600">สีเซลล์:</span>
            {[
              { cls: 'bg-white border border-gray-200',    label: 'ถูกต้อง' },
              { cls: 'bg-red-50 text-red-700',             label: 'ไม่พบ / ผิด' },
              { cls: 'bg-amber-50 text-amber-800',         label: 'น่าสงสัย' },
              { cls: 'bg-blue-50 text-blue-800',           label: 'AI อนุมาน' },
            ].map(({ cls, label }) => (
              <span key={label} className={`px-2 py-0.5 rounded font-medium ${cls}`}>{label}</span>
            ))}
            <span className="ml-auto text-gray-400">คลิกแถวเพื่อดูรายละเอียด</span>
          </div>

          {/* Spreadsheet */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="text-sm border-collapse" style={{ minWidth: 'max-content' }}>
              <thead>
                {/* Group header row */}
                <tr className="bg-gray-100 border-b border-gray-300">
                  <th className="sticky left-0 z-20 bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-500 border-r border-gray-300" rowSpan={2}>#</th>
                  <th className="px-3 py-2 text-xs font-semibold text-gray-500 border-r border-gray-300 text-center" rowSpan={2}>สถานะ AI</th>
                  <th
                    colSpan={INFO_COLS.length}
                    className="px-3 py-2 text-xs font-semibold text-[#185FA5] border-r border-gray-300 text-center bg-blue-50"
                  >
                    ข้อมูลลูกค้า / วงจร
                  </th>
                  <th
                    colSpan={ADDR_COLS.length}
                    className={`px-3 py-2 text-xs font-semibold text-emerald-700 text-center bg-emerald-50 ${hasNotes ? 'border-r border-gray-300' : ''}`}
                  >
                    ที่อยู่ปลายทาง
                  </th>
                  {hasNotes && (
                    <th className="px-3 py-2 text-xs font-semibold text-amber-700 text-center bg-amber-50" rowSpan={2}>
                      หมายเหตุจากผู้ส่ง
                    </th>
                  )}
                </tr>
                {/* Field name row */}
                <tr className="bg-gray-50 border-b border-gray-200">
                  {INFO_COLS.map((col, i) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap bg-blue-50/40 ${i < INFO_COLS.length - 1 ? 'border-r border-gray-100' : 'border-r border-gray-300'}`}
                    >
                      {col.label}
                    </th>
                  ))}
                  {ADDR_COLS.map((col, i) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap bg-emerald-50/40 ${i < ADDR_COLS.length - 1 ? 'border-r border-gray-100' : ''}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order, i) => {
                  const fvMap = buildFvMap(unwrapFv(order))
                  const note  = (order as RichOrder & { customer_note?: string }).customer_note
                  const isSelected = selectedOrderIdx === i

                  return (
                    <tr
                      key={order.id}
                      onClick={() => selectOrder(i)}
                      className={`border-b border-gray-100 last:border-b-0 cursor-pointer transition-colors ${
                        isSelected ? 'ring-2 ring-inset ring-[#185FA5]' : 'hover:bg-gray-50/60'
                      }`}
                    >
                      {/* Row number — sticky */}
                      <td className={`sticky left-0 z-10 px-3 py-2.5 text-xs text-center font-mono border-r border-gray-200 ${isSelected ? 'bg-blue-50 text-[#185FA5] font-bold' : 'bg-white text-gray-400'}`}>
                        {i + 1}
                      </td>

                      {/* AI status */}
                      <td className="px-3 py-2.5 border-r border-gray-200 text-center">
                        <AiStatusBadge status={order.ai_status} />
                      </td>

                      {/* Customer info cells */}
                      {INFO_COLS.map((col, ci) => {
                        const val    = getFieldValue(order, col.key)
                        const fv     = fvMap[col.key]
                        const status = fv?.status
                        return (
                          <td
                            key={col.key}
                            title={fv?.ai_note ?? undefined}
                            className={`px-3 py-2.5 whitespace-nowrap ${cellStyle(status)} ${ci < INFO_COLS.length - 1 ? 'border-r border-gray-100' : 'border-r border-gray-200'}`}
                          >
                            {val ?? <span className="text-gray-300">—</span>}
                          </td>
                        )
                      })}

                      {/* Address cells */}
                      {ADDR_COLS.map((col, ci) => {
                        const val    = getFieldValue(order, col.key)
                        const fv     = fvMap[col.key]
                        const status = fv?.status
                        return (
                          <td
                            key={col.key}
                            title={fv?.ai_note ?? undefined}
                            className={`px-3 py-2.5 whitespace-nowrap font-mono text-xs ${cellStyle(status)} ${ci < ADDR_COLS.length - 1 ? 'border-r border-gray-100' : ''}`}
                          >
                            {val ?? <span className="text-gray-300">—</span>}
                          </td>
                        )
                      })}

                      {/* Note */}
                      {hasNotes && (
                        <td className="px-3 py-2.5 text-xs text-amber-800 max-w-xs whitespace-normal leading-snug border-l border-gray-200">
                          {note ?? <span className="text-gray-300">—</span>}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer row */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-gray-400">
              {orders.length} คำสั่ง · วางเมาส์เหนือเซลล์เพื่อดูหมายเหตุ AI · คลิกแถวเพื่อเลือกและดูรายละเอียด
            </p>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-2 py-1"
            >
              {showRaw ? 'ซ่อน' : 'ดู'} Raw JSON
            </button>
          </div>

          {showRaw && selectedOrder && (
            <div className="bg-gray-900 rounded-xl p-4 overflow-auto max-h-96">
              <p className="text-xs text-gray-400 mb-2 font-mono">Raw — order {selectedOrderIdx + 1}</p>
              <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
                {JSON.stringify(selectedOrder, null, 2)}
              </pre>
            </div>
          )}

          {/* ── Detail panel for selected order ── */}
          {selectedOrder && (() => {
            const fvs      = unwrapFv(selectedOrder)
            const custFvs  = fvs.filter((f) => !ADDR_KEYS.has(f.field_name))
            const addrFvs  = fvs.filter((f) => ADDR_KEYS.has(f.field_name))
            const note     = (selectedOrder as RichOrder & { customer_note?: string }).customer_note

            const FIELD_LABELS: Record<string, string> = {
              customer_name: 'ชื่อลูกค้า', company_name: 'บริษัท', circuit_order_type: 'ประเภทวงจร',
              old_circuit: 'วงจรเดิม', product_package: 'แพ็คเกจ', speed: 'ความเร็ว',
              store_code: 'รหัสสาขา', branch_name: 'ชื่อสาขา', coordinator_name: 'ผู้ประสานงาน',
              coordinator_phone: 'เบอร์ติดต่อ', house_no: 'บ้านเลขที่', moo: 'หมู่ที่',
              building: 'อาคาร', floor: 'ชั้น', room: 'ห้อง', soi: 'ซอย', road: 'ถนน',
              subdistrict: 'แขวง/ตำบล', district: 'เขต/อำเภอ', province: 'จังหวัด',
              postcode: 'รหัสไปรษณีย์', latitude: 'ละติจูด', longitude: 'ลองจิจูด',
            }

            const DetailTable = ({ rows }: { rows: FieldValidation[] }) => (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-4 py-2 font-medium w-36">ฟิลด์</th>
                    <th className="text-left px-4 py-2 font-medium">ค่า</th>
                    <th className="text-left px-4 py-2 font-medium w-28">สถานะ</th>
                    <th className="text-left px-4 py-2 font-medium">หมายเหตุ AI</th>
                    <th className="text-right px-4 py-2 font-medium w-20">ความเชื่อมั่น</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length > 0 ? rows.map((f) => (
                    <tr key={f.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{FIELD_LABELS[f.field_name] ?? f.field_name}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{f.value || '—'}</td>
                      <td className="px-4 py-2.5">
                        <ValidationStatusBadge status={f.status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs">{f.ai_note || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                        {f.confidence != null ? `${Math.round((f.confidence) * 100)}%` : '—'}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-400 text-center">ไม่มีข้อมูล</td></tr>
                  )}
                </tbody>
              </table>
            )

            return (
              <div className="space-y-4 pt-2">
                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    รายละเอียด — คำสั่งที่ {selectedOrderIdx + 1}: {selectedOrder.customer_name ?? '(ไม่มีชื่อ)'}
                  </span>
                  <AiStatusBadge status={selectedOrder.ai_status} />
                  <div className="h-px flex-1 bg-gray-200" />
                </div>

                {/* Customer note */}
                {note && (
                  <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">หมายเหตุจากผู้ส่ง</p>
                      <p className="text-sm text-amber-900 leading-relaxed">{note}</p>
                    </div>
                  </div>
                )}

                {/* Customer / circuit fields */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ข้อมูลลูกค้า / วงจร</h3>
                  </div>
                  <DetailTable rows={custFvs} />
                </div>

                {/* Address fields */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ที่อยู่ปลายทาง</h3>
                  </div>
                  <DetailTable rows={addrFvs} />
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => setTab('geolocation')}
                    className="text-sm font-medium text-[#185FA5] hover:underline"
                  >
                    ดูแผนที่และพิกัด →
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Geolocation tab ── */}
      {tab === 'geolocation' && batch && (
        <div className="space-y-4">
          {orders.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {orders.map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => selectOrder(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedOrderIdx === i ? 'text-white border-[#185FA5]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#185FA5]'
                  }`}
                  style={selectedOrderIdx === i ? { backgroundColor: '#185FA5' } : {}}
                >
                  วงจร {i + 1}: {o.customer_name ?? '(ไม่มีชื่อ)'}
                </button>
              ))}
            </div>
          )}

          {selectedOrder && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">ที่อยู่ติดตั้ง</h3>
                    <AiStatusBadge status={selectedOrder.ai_status} />
                  </div>
                  {address ? (() => {
                    const fvMap = buildFvMap(fieldValidations)
                    const addrFields: [string, keyof Address][] = [
                      ['บ้านเลขที่', 'house_no'], ['หมู่ที่', 'moo'], ['อาคาร', 'building'],
                      ['ชั้น', 'floor'], ['ห้อง', 'room'], ['ซอย', 'soi'], ['ถนน', 'road'],
                      ['แขวง/ตำบล', 'subdistrict'], ['เขต/อำเภอ', 'district'],
                      ['จังหวัด', 'province'], ['รหัสไปรษณีย์', 'postcode'],
                    ]
                    return (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {addrFields.map(([label, key]) => {
                          const value = address[key]
                          const v     = fvMap[key]
                          const isSuggested  = v?.status === 'suggested'
                          const isSuspicious = v?.status === 'suspicious' || v?.status === 'incorrect'
                          return (
                            <div key={key}>
                              <dt className="text-xs text-gray-400 mb-0.5">{label}</dt>
                              <dd className="flex items-start gap-1.5">
                                <span className={`font-medium ${value ? 'text-gray-900' : 'text-gray-300'}`}>
                                  {value ?? '—'}
                                </span>
                                {value && isSuggested  && <span title={v?.ai_note ?? ''} className="mt-0.5 w-2 h-2 rounded-full bg-blue-400 flex-shrink-0 cursor-help" />}
                                {value && isSuspicious && <span title={v?.ai_note ?? ''} className="mt-0.5 w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0 cursor-help" />}
                              </dd>
                              {v?.ai_note && (isSuggested || isSuspicious) && (
                                <p className="text-xs text-gray-400 mt-0.5 leading-tight">{v.ai_note}</p>
                              )}
                            </div>
                          )
                        })}
                      </dl>
                    )
                  })() : <p className="text-sm text-gray-400">ไม่มีข้อมูลที่อยู่</p>}
                </div>

                {address && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-700">พิกัด GPS</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <dt className="text-xs text-gray-400">ละติจูด</dt>
                        <dd className="font-medium font-mono text-gray-900">{address.latitude ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-400">ลองจิจูด</dt>
                        <dd className="font-medium font-mono text-gray-900">{address.longitude ?? '—'}</dd>
                      </div>
                    </div>
                    {address.input_format && (
                      <p className="text-xs text-gray-400">รูปแบบ: {address.input_format}</p>
                    )}
                  </div>
                )}

                {/* Customer note */}
                {(selectedOrder as RichOrder & { customer_note?: string }).customer_note && (
                  <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">หมายเหตุจากผู้ส่ง</p>
                      <p className="text-sm text-amber-900 leading-relaxed">
                        {(selectedOrder as RichOrder & { customer_note?: string }).customer_note}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                {address?.latitude && address?.longitude ? (
                  <MapPreview lat={address.latitude} lng={address.longitude} />
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-gray-200 h-64 flex items-center justify-center">
                    <p className="text-sm text-gray-400">ไม่มีพิกัด GPS</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
