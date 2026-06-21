'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { Batch, Order, FieldValidation, Address } from '@fc/shared'
import { uploadBatch } from '@/lib/api'
import { AiStatusBadge } from '../components/StatusBadge'
import MapPreview from '../components/MapPreview'
import ExtractionTab from './ExtractionTab'

type Tab = 'upload' | 'extraction' | 'geolocation'
const STORAGE_KEY = 'fc-current-batch'

// ── Helpers (used by geolocation tab) ────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewBatchClient() {
  const [tab, setTab]           = useState<Tab>('upload')
  const [dragging, setDragging] = useState(false)
  const [file, setFile]         = useState<File | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [batch, setBatch]       = useState<(Batch & { orders: Order[] }) | null>(null)
  const [selectedOrderIdx, setSelectedOrderIdx] = useState(0)
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
    setSelectedOrderIdx(0); setTab('upload')
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
      saveBatch(result); setSelectedOrderIdx(0); setTab('extraction')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    } finally { setLoading(false) }
  }

  const orders = (batch?.orders ?? []) as RichOrder[]
  const selectedOrder = orders[selectedOrderIdx]
  const address = selectedOrder ? unwrapAddr(selectedOrder) : undefined
  const fieldValidations = selectedOrder ? unwrapFv(selectedOrder) : []

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

      {/* ── Extraction tab ── */}
      {tab === 'extraction' && batch && (
        <ExtractionTab
          key={batch.id}
          orders={orders}
          onSelectOrder={setSelectedOrderIdx}
        />
      )}

      {/* ── Geolocation tab ── */}
      {tab === 'geolocation' && batch && (
        <div className="space-y-4">
          {orders.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {orders.map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => setSelectedOrderIdx(i)}
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
