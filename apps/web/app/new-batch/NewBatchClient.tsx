'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { Batch, Order, FieldValidation, Address } from '@fc/shared'
import { uploadBatch } from '@/lib/api'
import { AiStatusBadge, ValidationStatusBadge } from '../components/StatusBadge'
import MapPreview from '../components/MapPreview'

type Tab = 'upload' | 'extraction' | 'geolocation'
const STORAGE_KEY = 'fc-current-batch'

export default function NewBatchClient() {
  const [tab, setTab] = useState<Tab>('upload')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batch, setBatch] = useState<(Batch & { orders: Order[] }) | null>(null)
  const [selectedOrderIdx, setSelectedOrderIdx] = useState(0)
  const [showRaw, setShowRaw] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Restore batch from localStorage on first mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        setBatch(parsed)
        setTab('extraction')
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const saveBatch = (b: Batch & { orders: Order[] }) => {
    setBatch(b)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(b)) } catch { /* quota */ }
  }

  const clearBatch = () => {
    setBatch(null)
    setFile(null)
    setError(null)
    setSelectedOrderIdx(0)
    setShowRaw(false)
    setTab('upload')
    localStorage.removeItem(STORAGE_KEY)
  }

  const handleFile = (f: File) => {
    if (!/\.(eml|msg)$/i.test(f.name)) {
      setError('กรุณาเลือกไฟล์ .eml หรือ .msg เท่านั้น')
      return
    }
    setFile(f)
    setError(null)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [])

  const onSubmit = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const result = await uploadBatch(file)
      saveBatch(result)
      setSelectedOrderIdx(0)
      setShowRaw(false)
      setTab('extraction')
      console.log('[UI] full batch response:', JSON.stringify(result, null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  const selectedOrder = batch?.orders?.[selectedOrderIdx]

  // Supabase join returns addresses as an array even for 1-to-1
  const rawAddr = (selectedOrder as Order & { addresses?: Address | Address[] })?.addresses
  const address: Address | undefined = Array.isArray(rawAddr) ? rawAddr[0] : rawAddr

  // field_validations is always an array from the join
  const rawFv = (selectedOrder as Order & { field_validations?: FieldValidation[] })?.field_validations
  const fieldValidations: FieldValidation[] = Array.isArray(rawFv) ? rawFv : []

  // Log whenever selected order changes so we can inspect in DevTools
  useEffect(() => {
    if (selectedOrder) {
      console.log('[UI] selectedOrder:', JSON.stringify(selectedOrder, null, 2))
      console.log('[UI] address:', JSON.stringify(address, null, 2))
      console.log('[UI] fieldValidations:', JSON.stringify(fieldValidations, null, 2))
    }
  }, [selectedOrder])

  const ADDRESS_FIELD_NAMES = new Set(['house_no','moo','building','floor','room','soi','road','subdistrict','district','province','postcode','latitude','longitude'])
  const customerFields = fieldValidations.filter((f) => !ADDRESS_FIELD_NAMES.has(f.field_name))
  const addressFields = fieldValidations.filter((f) => ADDRESS_FIELD_NAMES.has(f.field_name))

  const FIELD_LABELS: Record<string, string> = {
    customer_name: 'ชื่อลูกค้า', company_name: 'บริษัท', circuit_order_type: 'ประเภทวงจร',
    old_circuit: 'วงจรเดิม', product_package: 'แพ็คเกจ', speed: 'ความเร็ว',
    store_code: 'รหัสสาขา', branch_name: 'ชื่อสาขา', coordinator_name: 'ผู้ประสานงาน',
    coordinator_phone: 'เบอร์ติดต่อ', house_no: 'บ้านเลขที่', moo: 'หมู่ที่',
    building: 'อาคาร', floor: 'ชั้น', room: 'ห้อง', soi: 'ซอย', road: 'ถนน',
    subdistrict: 'แขวง/ตำบล', district: 'เขต/อำเภอ', province: 'จังหวัด',
    postcode: 'รหัสไปรษณีย์', latitude: 'ละติจูด', longitude: 'ลองจิจูด',
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">New Batch</h1>
          <p className="text-sm text-gray-500 mt-1">อัปโหลดอีเมลคำสั่งติดตั้งและให้ AI วิเคราะห์ที่อยู่</p>
          {batch && (
            <p className="text-xs text-gray-400 mt-1">
              Batch: <span className="font-mono">{batch.batch_code}</span>
              {' · '}{batch.orders.length} คำสั่ง
            </p>
          )}
        </div>
        {batch && (
          <button
            onClick={clearBatch}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" transform="rotate(45 12 12)" />
            </svg>
            เริ่ม Batch ใหม่
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6 gap-1">
        {(['upload', 'extraction', 'geolocation'] as Tab[]).map((t) => {
          const labels: Record<Tab, string> = { upload: 'อัปโหลด', extraction: 'ข้อมูลและการตรวจสอบ', geolocation: 'ที่อยู่และพิกัด' }
          const active = tab === t
          const enabled = t === 'upload' || !!batch
          return (
            <button
              key={t}
              onClick={() => enabled && setTab(t)}
              disabled={!enabled}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-[#185FA5] text-[#185FA5]'
                  : enabled
                  ? 'border-transparent text-gray-500 hover:text-gray-700'
                  : 'border-transparent text-gray-300 cursor-not-allowed'
              }`}
            >
              {labels[t]}
            </button>
          )
        })}
      </div>

      {/* Upload tab */}
      {tab === 'upload' && (
        <div className="space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
              dragging ? 'border-[#185FA5] bg-blue-50' : 'border-gray-300 hover:border-[#185FA5] hover:bg-gray-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".eml,.msg"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
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

      {/* Extraction tab */}
      {tab === 'extraction' && batch && (
        <div className="space-y-4">
          {/* Order selector */}
          {batch.orders.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {batch.orders.map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => setSelectedOrderIdx(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedOrderIdx === i
                      ? 'text-white border-[#185FA5]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-[#185FA5]'
                  }`}
                  style={selectedOrderIdx === i ? { backgroundColor: '#185FA5' } : {}}
                >
                  วงจร {i + 1}: {o.customer_name ?? '(ไม่มีชื่อ)'}
                </button>
              ))}
            </div>
          )}

          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{selectedOrder.customer_name ?? '(ไม่มีชื่อลูกค้า)'}</h2>
                <AiStatusBadge status={selectedOrder.ai_status} />
              </div>

              {/* Customer / circuit info */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ข้อมูลลูกค้า / วงจร</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left px-4 py-2 font-medium">ฟิลด์</th>
                      <th className="text-left px-4 py-2 font-medium">ค่า</th>
                      <th className="text-left px-4 py-2 font-medium">สถานะ</th>
                      <th className="text-left px-4 py-2 font-medium">หมายเหตุ AI</th>
                      <th className="text-right px-4 py-2 font-medium">ความเชื่อมั่น</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerFields.length > 0 ? customerFields.map((f) => (
                      <tr key={f.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{FIELD_LABELS[f.field_name] ?? f.field_name}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{f.value ?? '—'}</td>
                        <td className="px-4 py-2.5"><ValidationStatusBadge status={f.status} /></td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs">{f.ai_note ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                          {f.confidence !== null ? `${Math.round((f.confidence ?? 0) * 100)}%` : '—'}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-400 text-center">ไม่มีข้อมูลการตรวจสอบ</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Address fields */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ที่อยู่ปลายทาง</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left px-4 py-2 font-medium">ฟิลด์</th>
                      <th className="text-left px-4 py-2 font-medium">ค่า</th>
                      <th className="text-left px-4 py-2 font-medium">สถานะ</th>
                      <th className="text-left px-4 py-2 font-medium">หมายเหตุ AI</th>
                      <th className="text-right px-4 py-2 font-medium">ความเชื่อมั่น</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addressFields.length > 0 ? addressFields.map((f) => (
                      <tr key={f.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{FIELD_LABELS[f.field_name] ?? f.field_name}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{f.value ?? '—'}</td>
                        <td className="px-4 py-2.5"><ValidationStatusBadge status={f.status} /></td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs">{f.ai_note ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                          {f.confidence !== null ? `${Math.round((f.confidence ?? 0) * 100)}%` : '—'}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-400 text-center">ไม่มีข้อมูลที่อยู่</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setTab('geolocation')}
                  className="text-sm font-medium text-[#185FA5] hover:underline"
                >
                  ดูที่อยู่และพิกัด →
                </button>
                <button
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-2 py-1"
                >
                  {showRaw ? 'ซ่อน' : 'ดู'} Raw Extraction
                </button>
              </div>

              {/* Raw extraction debug panel */}
              {showRaw && selectedOrder && (
                <div className="bg-gray-900 rounded-xl p-4 overflow-auto max-h-96">
                  <p className="text-xs text-gray-400 mb-2 font-mono">Raw API response — order {selectedOrderIdx + 1}</p>
                  <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
                    {JSON.stringify(selectedOrder, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Geolocation tab */}
      {tab === 'geolocation' && batch && (
        <div className="space-y-4">
          {batch.orders.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {batch.orders.map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => setSelectedOrderIdx(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedOrderIdx === i
                      ? 'text-white border-[#185FA5]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-[#185FA5]'
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
              {/* Address fields */}
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">ที่อยู่ติดตั้ง</h3>
                    <span className="text-xs text-gray-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />แนะนำโดย AI
                    </span>
                  </div>
                  {address ? (() => {
                    // Build a lookup of field_name → validation for status indicators
                    const fieldMap = Object.fromEntries(
                      fieldValidations.map((f) => [f.field_name, f])
                    )
                    const addrFields: [string, string, string | null][] = [
                      ['บ้านเลขที่', 'house_no', address.house_no],
                      ['หมู่ที่', 'moo', address.moo],
                      ['อาคาร', 'building', address.building],
                      ['ชั้น', 'floor', address.floor],
                      ['ห้อง', 'room', address.room],
                      ['ซอย', 'soi', address.soi],
                      ['ถนน', 'road', address.road],
                      ['แขวง/ตำบล', 'subdistrict', address.subdistrict],
                      ['เขต/อำเภอ', 'district', address.district],
                      ['จังหวัด', 'province', address.province],
                      ['รหัสไปรษณีย์', 'postcode', address.postcode],
                    ]
                    return (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {addrFields.map(([label, key, value]) => {
                          const v = fieldMap[key]
                          const isSuggested = v?.status === 'suggested'
                          const isSuspicious = v?.status === 'suspicious' || v?.status === 'incorrect'
                          return (
                            <div key={key}>
                              <dt className="text-xs text-gray-400 mb-0.5">{label}</dt>
                              <dd className="flex items-start gap-1.5">
                                <span className={`font-medium ${value ? 'text-gray-900' : 'text-gray-300'}`}>
                                  {value ?? '—'}
                                </span>
                                {value && isSuggested && (
                                  <span title={v?.ai_note ?? 'อนุมานโดย AI'} className="mt-0.5 w-2 h-2 rounded-full bg-blue-400 flex-shrink-0 cursor-help" />
                                )}
                                {value && isSuspicious && (
                                  <span title={v?.ai_note ?? 'น่าสงสัย'} className="mt-0.5 w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0 cursor-help" />
                                )}
                              </dd>
                              {v?.ai_note && (isSuggested || isSuspicious) && (
                                <p className="text-xs text-gray-400 mt-0.5 leading-tight">{v.ai_note}</p>
                              )}
                            </div>
                          )
                        })}
                      </dl>
                    )
                  })() : (
                    <p className="text-sm text-gray-400">ไม่มีข้อมูลที่อยู่</p>
                  )}
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
              </div>

              {/* Map */}
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
