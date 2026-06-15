'use client'

import { useState, useEffect, useCallback } from 'react'
import type { OrderListItem, Order, Address, FieldValidation, ReviewStatus } from '@fc/shared'
import { listOrders, getOrder, reviewOrder } from '@/lib/api'
import { AiStatusBadge, ReviewStatusBadge, ValidationStatusBadge } from '../components/StatusBadge'
import MapPreview from '../components/MapPreview'

const STATUS_FILTERS = [
  { value: 'all',      label: 'ทั้งหมด' },
  { value: 'pending',  label: 'รอตรวจ' },
  { value: 'verified', label: 'ยืนยันแล้ว' },
  { value: 'flagged',  label: 'ต้องแก้' },
]

// Supabase joins always return arrays — unwrap to single item
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function first<T>(v: T | T[] | null | undefined): T | undefined {
  if (v == null) return undefined
  return Array.isArray(v) ? v[0] : v
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

function groupBySender(rows: OrderListItem[]): { sender: string; items: OrderListItem[] }[] {
  const map = new Map<string, OrderListItem[]>()
  for (const row of rows) {
    const key = row.email_from ?? 'ไม่ระบุผู้ส่ง'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return Array.from(map.entries()).map(([sender, items]) => ({ sender, items }))
}

const ADDRESS_ROWS: [string, keyof Address][] = [
  ['บ้านเลขที่',  'house_no'],
  ['หมู่ที่',     'moo'],
  ['อาคาร',      'building'],
  ['ชั้น',       'floor'],
  ['ห้อง',       'room'],
  ['ซอย',        'soi'],
  ['ถนน',        'road'],
  ['แขวง/ตำบล',  'subdistrict'],
  ['เขต/อำเภอ',  'district'],
  ['จังหวัด',    'province'],
  ['รหัสไปรษณีย์','postcode'],
]

const FIELD_LABELS: Record<string, string> = {
  customer_name: 'ชื่อลูกค้า', company_name: 'บริษัท',
  circuit_order_type: 'ประเภทวงจร', old_circuit: 'วงจรเดิม',
  product_package: 'แพ็คเกจ', speed: 'ความเร็ว',
  store_code: 'รหัสสาขา', branch_name: 'ชื่อสาขา',
  coordinator_name: 'ผู้ประสานงาน', coordinator_phone: 'เบอร์ติดต่อ',
  house_no: 'บ้านเลขที่', moo: 'หมู่ที่', building: 'อาคาร',
  floor: 'ชั้น', room: 'ห้อง', soi: 'ซอย', road: 'ถนน',
  subdistrict: 'แขวง/ตำบล', district: 'เขต/อำเภอ',
  province: 'จังหวัด', postcode: 'รหัสไปรษณีย์',
  latitude: 'ละติจูด', longitude: 'ลองจิจูด',
}

const ADDRESS_FIELD_NAMES = new Set([
  'house_no','moo','building','floor','room','soi','road',
  'subdistrict','district','province','postcode','latitude','longitude',
])

export default function HistoryClient() {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [status, setStatus] = useState('all')
  const [rows, setRows] = useState<OrderListItem[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [drawerOrder, setDrawerOrder] = useState<any | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null)
  const [drawerTab, setDrawerTab] = useState<'address' | 'fields'>('address')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listOrders({
        q: debouncedQ || undefined,
        status: status !== 'all' ? status : undefined,
      })
      setRows(res.data)
      setCount(res.count)
    } catch { /* keep stale */ }
    finally { setLoading(false) }
  }, [debouncedQ, status])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const openDrawer = async (id: string) => {
    setDrawerOrderId(id)
    setDrawerOrder(null)
    setDrawerLoading(true)
    setReviewNote('')
    setReviewSuccess(null)
    setDrawerTab('address')
    try {
      const o = await getOrder(id)
      setDrawerOrder(o)
      const rev = first((o as Order & { reviews?: unknown }).reviews as { note?: string } | { note?: string }[])
      setReviewNote(rev?.note ?? '')
    } finally {
      setDrawerLoading(false)
    }
  }

  const closeDrawer = () => { setDrawerOrderId(null); setDrawerOrder(null) }

  const handleReview = async (is_status: ReviewStatus) => {
    if (!drawerOrderId) return
    setReviewLoading(true)
    setReviewSuccess(null)
    try {
      await reviewOrder(drawerOrderId, { is_status, note: reviewNote })
      setReviewSuccess(is_status === 'verified' ? 'ยืนยันเรียบร้อย' : 'บันทึกว่าต้องแก้ไข')
      fetchOrders()
    } finally { setReviewLoading(false) }
  }

  // Unwrap Supabase join arrays
  const drawerAddress: Address | undefined = first(drawerOrder?.addresses)
  const drawerReview: { is_status?: ReviewStatus; note?: string } | undefined = first(drawerOrder?.reviews)
  const drawerValidations: FieldValidation[] = Array.isArray(drawerOrder?.field_validations)
    ? drawerOrder.field_validations
    : []
  const customerValidations = drawerValidations.filter((f) => !ADDRESS_FIELD_NAMES.has(f.field_name))
  const addressValidations  = drawerValidations.filter((f) => ADDRESS_FIELD_NAMES.has(f.field_name))

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">History</h1>
        <p className="text-sm text-gray-500 mt-1">ค้นหาและตรวจสอบที่อยู่ทั้งหมด ({count} รายการ)</p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="ค้นหาชื่อลูกค้า, บริษัท..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#185FA5] focus:border-transparent"
          />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                status === f.value ? 'text-white border-[#185FA5]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
              style={status === f.value ? { backgroundColor: '#185FA5' } : {}}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">ไม่พบรายการ</div>
      ) : (
        <div className="space-y-5">
          {groupBySender(rows).map(({ sender, items }) => (
            <div key={sender} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Sender header */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-xs font-semibold text-gray-700 truncate">{sender}</span>
                <span className="ml-auto text-xs text-gray-400 flex-shrink-0">{items.length} รายการ</span>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100">
                  <tr className="text-xs text-gray-400">
                    <th className="text-left px-4 py-2.5 font-medium">Batch</th>
                    <th className="text-left px-4 py-2.5 font-medium">ลูกค้า</th>
                    <th className="text-left px-4 py-2.5 font-medium">ที่อยู่</th>
                    <th className="text-left px-4 py-2.5 font-medium">AI</th>
                    <th className="text-left px-4 py-2.5 font-medium">สถานะตรวจ</th>
                    <th className="text-left px-4 py-2.5 font-medium">วันที่และเวลา</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((row) => (
                    <tr key={row.id} onClick={() => openDrawer(row.id)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.batch_code}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.customer_name ?? '—'}</div>
                        {row.company_name && <div className="text-xs text-gray-400">{row.company_name}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{row.address_summary ?? '—'}</td>
                      <td className="px-4 py-3"><AiStatusBadge status={row.ai_status} /></td>
                      <td className="px-4 py-3"><ReviewStatusBadge status={row.review_status} /></td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {formatDateTime(row.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Drawer */}
      {drawerOrderId && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={closeDrawer} />
          <aside className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200" style={{ backgroundColor: '#185FA5' }}>
              <div>
                <h2 className="font-semibold text-white">{drawerOrder?.customer_name ?? 'รายละเอียดคำสั่ง'}</h2>
                {drawerOrder?.company_name && <p className="text-xs text-blue-200 mt-0.5">{drawerOrder.company_name}</p>}
                {drawerOrder && (
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <AiStatusBadge status={drawerOrder.ai_status} />
                    {drawerReview?.is_status && <ReviewStatusBadge status={drawerReview.is_status} />}
                  </div>
                )}
              </div>
              <button onClick={closeDrawer} className="text-white opacity-70 hover:opacity-100 transition ml-4 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Drawer tabs */}
            {!drawerLoading && drawerOrder && (
              <div className="flex border-b border-gray-200 px-5 gap-4">
                {(['address', 'fields'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDrawerTab(t)}
                    className={`py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                      drawerTab === t ? 'border-[#185FA5] text-[#185FA5]' : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t === 'address' ? 'ที่อยู่และแผนที่' : 'ข้อมูลทั้งหมด'}
                  </button>
                ))}
              </div>
            )}

            {drawerLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">กำลังโหลด...</div>
            ) : drawerOrder ? (
              <div className="flex-1 overflow-y-auto">

                {/* ── Address tab ── */}
                {drawerTab === 'address' && (
                  <div className="p-5 space-y-4">
                    <div className="bg-gray-50 rounded-xl p-4">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">ที่อยู่ติดตั้ง</h3>
                      {drawerAddress ? (
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                          {ADDRESS_ROWS.map(([label, key]) => {
                            const val = drawerAddress[key]
                            const validation = addressValidations.find((f) => f.field_name === key)
                            return (
                              <div key={key}>
                                <dt className="text-xs text-gray-400 mb-0.5">{label}</dt>
                                <dd className="flex items-start gap-1">
                                  <span className={`font-medium ${val ? 'text-gray-900' : 'text-gray-300'}`}>
                                    {val ?? '—'}
                                  </span>
                                  {validation && validation.status !== 'correct' && validation.status !== 'missing' && (
                                    <ValidationStatusBadge status={validation.status} />
                                  )}
                                </dd>
                                {validation?.ai_note && validation.status !== 'correct' && (
                                  <p className="text-xs text-amber-600 mt-0.5 leading-snug">{validation.ai_note}</p>
                                )}
                              </div>
                            )
                          })}
                        </dl>
                      ) : (
                        <p className="text-sm text-gray-400">ไม่มีข้อมูลที่อยู่</p>
                      )}
                    </div>

                    {/* GPS */}
                    {drawerAddress && (drawerAddress.latitude || drawerAddress.longitude) && (
                      <div className="bg-gray-50 rounded-xl p-4">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">พิกัด GPS</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <dt className="text-xs text-gray-400">ละติจูด</dt>
                            <dd className="font-mono font-medium text-gray-900">{drawerAddress.latitude ?? '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-gray-400">ลองจิจูด</dt>
                            <dd className="font-mono font-medium text-gray-900">{drawerAddress.longitude ?? '—'}</dd>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Map */}
                    {drawerAddress?.latitude && drawerAddress?.longitude && (
                      <MapPreview lat={drawerAddress.latitude} lng={drawerAddress.longitude} />
                    )}
                  </div>
                )}

                {/* ── All fields tab ── */}
                {drawerTab === 'fields' && (
                  <div className="p-5 space-y-4">
                    {/* Customer / circuit fields */}
                    {customerValidations.length > 0 && (
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ข้อมูลลูกค้า / วงจร</h3>
                        </div>
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-gray-50">
                            {customerValidations.map((f) => (
                              <tr key={f.id}>
                                <td className="px-4 py-2.5 text-xs text-gray-500 w-32 shrink-0">
                                  {FIELD_LABELS[f.field_name] ?? f.field_name}
                                </td>
                                <td className="px-4 py-2.5 font-medium text-gray-900">
                                  {f.value ?? <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-4 py-2.5">
                                  <ValidationStatusBadge status={f.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Address fields */}
                    {addressValidations.length > 0 && (
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ที่อยู่</h3>
                        </div>
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-gray-50">
                            {addressValidations.map((f) => (
                              <tr key={f.id}>
                                <td className="px-4 py-2.5 text-xs text-gray-500 w-32 shrink-0">
                                  {FIELD_LABELS[f.field_name] ?? f.field_name}
                                </td>
                                <td className="px-4 py-2.5 font-medium text-gray-900">
                                  {f.value ?? <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-4 py-2.5"><ValidationStatusBadge status={f.status} /></td>
                                <td className="px-4 py-2.5 text-xs text-amber-600 max-w-[160px]">{f.ai_note || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Review note — always visible at bottom of scroll */}
                <div className="px-5 pb-4 space-y-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">หมายเหตุการตรวจ</label>
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    rows={3}
                    placeholder="บันทึกหมายเหตุ (ถ้ามี)..."
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
                  />
                  {reviewSuccess && (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
                      {reviewSuccess}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Footer actions */}
            {drawerOrder && (
              <div className="border-t border-gray-200 px-5 py-4 flex gap-3">
                <button
                  onClick={() => handleReview('verified')}
                  disabled={reviewLoading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60"
                  style={{ backgroundColor: '#185FA5' }}
                >
                  ยืนยันถูกต้อง
                </button>
                <button
                  onClick={() => handleReview('flagged')}
                  disabled={reviewLoading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-60"
                >
                  ต้องแก้ไข
                </button>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  )
}
