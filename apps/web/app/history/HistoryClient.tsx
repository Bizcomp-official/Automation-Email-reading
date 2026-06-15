'use client'

import { useState, useEffect, useCallback } from 'react'
import type { OrderListItem, Order, Address, ReviewStatus } from '@fc/shared'
import { listOrders, getOrder, reviewOrder } from '@/lib/api'
import { AiStatusBadge, ReviewStatusBadge } from '../components/StatusBadge'
import MapPreview from '../components/MapPreview'

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'pending', label: 'รอตรวจ' },
  { value: 'verified', label: 'ยืนยันแล้ว' },
  { value: 'flagged', label: 'ต้องแก้' },
]

export default function HistoryClient() {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [status, setStatus] = useState('all')
  const [rows, setRows] = useState<OrderListItem[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null)
  const [drawerOrder, setDrawerOrder] = useState<(Order & { addresses?: Address; address?: Address }) | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listOrders({ q: debouncedQ || undefined, status: status !== 'all' ? status : undefined })
      setRows(res.data)
      setCount(res.count)
    } catch {
      // keep stale data
    } finally {
      setLoading(false)
    }
  }, [debouncedQ, status])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const openDrawer = async (id: string) => {
    setDrawerOrderId(id)
    setDrawerOrder(null)
    setDrawerLoading(true)
    setReviewNote('')
    setReviewSuccess(null)
    try {
      const o = await getOrder(id) as Order & { addresses?: Address; address?: Address; reviews?: { note?: string } }
      setDrawerOrder(o)
      setReviewNote((o as { reviews?: { note?: string } }).reviews?.note ?? '')
    } finally {
      setDrawerLoading(false)
    }
  }

  const closeDrawer = () => {
    setDrawerOrderId(null)
    setDrawerOrder(null)
  }

  const handleReview = async (is_status: ReviewStatus) => {
    if (!drawerOrderId) return
    setReviewLoading(true)
    setReviewSuccess(null)
    try {
      await reviewOrder(drawerOrderId, { is_status, note: reviewNote })
      setReviewSuccess(is_status === 'verified' ? 'ยืนยันเรียบร้อย' : 'บันทึกว่าต้องแก้ไข')
      fetchOrders()
    } finally {
      setReviewLoading(false)
    }
  }

  const drawerAddress = drawerOrder?.addresses ?? drawerOrder?.address
  const drawerReview = (drawerOrder as Order & { reviews?: { is_status?: ReviewStatus; note?: string } })?.reviews

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
            placeholder="ค้นหาชื่อลูกค้า, บริษัท, ที่อยู่..."
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
                status === f.value
                  ? 'text-white border-[#185FA5]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
              style={status === f.value ? { backgroundColor: '#185FA5' } : {}}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">ไม่พบรายการ</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-xs text-gray-500">
                <th className="text-left px-4 py-3 font-medium">Batch</th>
                <th className="text-left px-4 py-3 font-medium">ลูกค้า</th>
                <th className="text-left px-4 py-3 font-medium">ที่อยู่</th>
                <th className="text-left px-4 py-3 font-medium">AI</th>
                <th className="text-left px-4 py-3 font-medium">สถานะตรวจ</th>
                <th className="text-left px-4 py-3 font-medium">วันที่</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => openDrawer(row.id)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.batch_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{row.customer_name ?? '—'}</div>
                    {row.company_name && <div className="text-xs text-gray-400">{row.company_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{row.address_summary ?? '—'}</td>
                  <td className="px-4 py-3"><AiStatusBadge status={row.ai_status} /></td>
                  <td className="px-4 py-3"><ReviewStatusBadge status={row.review_status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Drawer */}
      {drawerOrderId && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={closeDrawer}
          />
          <aside className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200" style={{ backgroundColor: '#185FA5' }}>
              <div>
                <h2 className="font-semibold text-white text-sm">
                  {drawerOrder?.customer_name ?? 'รายละเอียดคำสั่ง'}
                </h2>
                {drawerOrder?.company_name && (
                  <p className="text-xs text-blue-200 mt-0.5">{drawerOrder.company_name}</p>
                )}
              </div>
              <button onClick={closeDrawer} className="text-white opacity-70 hover:opacity-100 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {drawerLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">กำลังโหลด...</div>
            ) : drawerOrder ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Status row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <AiStatusBadge status={drawerOrder.ai_status} />
                  {drawerReview?.is_status && <ReviewStatusBadge status={drawerReview.is_status} />}
                </div>

                {/* Address */}
                {drawerAddress && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">ที่อยู่ติดตั้ง</h3>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {[
                        ['บ้านเลขที่', drawerAddress.house_no],
                        ['หมู่ที่', drawerAddress.moo],
                        ['อาคาร', drawerAddress.building],
                        ['ชั้น', drawerAddress.floor],
                        ['ซอย', drawerAddress.soi],
                        ['ถนน', drawerAddress.road],
                        ['แขวง/ตำบล', drawerAddress.subdistrict],
                        ['เขต/อำเภอ', drawerAddress.district],
                        ['จังหวัด', drawerAddress.province],
                        ['รหัสไปรษณีย์', drawerAddress.postcode],
                      ].map(([label, value]) => (
                        <div key={label as string}>
                          <dt className="text-xs text-gray-400">{label}</dt>
                          <dd className="font-medium text-gray-800">{value ?? '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* Map */}
                {drawerAddress?.latitude && drawerAddress?.longitude && (
                  <MapPreview lat={drawerAddress.latitude} lng={drawerAddress.longitude} />
                )}

                {/* AI note from field_validations */}
                {(drawerOrder as Order & { field_validations?: { ai_note?: string; status: string }[] }).field_validations
                  ?.filter((f) => f.ai_note && f.status !== 'correct')
                  .slice(0, 3)
                  .map((f, i) => (
                    <div key={i} className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-800">
                      {f.ai_note}
                    </div>
                  ))}

                {/* Review */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">หมายเหตุการตรวจ</label>
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    rows={3}
                    placeholder="บันทึกหมายเหตุ (ถ้ามี)..."
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
                  />
                </div>

                {reviewSuccess && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
                    {reviewSuccess}
                  </div>
                )}
              </div>
            ) : null}

            {/* Drawer footer actions */}
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
