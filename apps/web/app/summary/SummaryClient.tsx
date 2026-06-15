'use client'

import { useEffect, useState } from 'react'
import type { SummaryStats } from '@fc/shared'
import { getSummary } from '@/lib/api'

function StatCard({
  label,
  value,
  sublabel,
  color,
}: {
  label: string
  value: string | number
  sublabel?: string
  color: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-2">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm font-medium text-gray-700">{label}</div>
      {sublabel && <div className="text-xs text-gray-400">{sublabel}</div>}
    </div>
  )
}

export default function SummaryClient() {
  const [stats, setStats] = useState<SummaryStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSummary().then(setStats).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-sm text-gray-400">กำลังโหลด...</div>
      </div>
    )
  }

  if (!stats) return null

  const verifiedPct = stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Summary</h1>
        <p className="text-sm text-gray-500 mt-1">ภาพรวมการวิเคราะห์และตรวจสอบที่อยู่</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="คำสั่งทั้งหมด" value={stats.total} sublabel="Total orders" color="text-gray-900" />
        <StatCard label="ยืนยันแล้ว" value={stats.verified} sublabel={`${verifiedPct}% ของทั้งหมด`} color="text-green-700" />
        <StatCard label="รอตรวจ" value={stats.pending} sublabel="Pending review" color="text-orange-600" />
        <StatCard label="ต้องแก้ไข" value={stats.flagged} sublabel="Flagged" color="text-red-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">ความเชื่อมั่นเฉลี่ยของ AI</h2>
          {stats.avg_confidence !== null ? (
            <div className="flex items-end gap-3">
              <span className="text-4xl font-bold text-[#185FA5]">
                {Math.round((stats.avg_confidence ?? 0) * 100)}%
              </span>
              <span className="text-sm text-gray-400 mb-1">Average confidence</span>
            </div>
          ) : (
            <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>
          )}

          {/* Simple progress bar */}
          {stats.avg_confidence !== null && (
            <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.round((stats.avg_confidence ?? 0) * 100)}%`,
                  backgroundColor: '#185FA5',
                }}
              />
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">สัดส่วนสถานะการตรวจ</h2>
          {stats.total > 0 ? (
            <div className="space-y-3">
              {[
                { label: 'ยืนยันแล้ว', count: stats.verified, color: '#16a34a' },
                { label: 'รอตรวจ', count: stats.pending, color: '#ea580c' },
                { label: 'ต้องแก้ไข', count: stats.flagged, color: '#dc2626' },
              ].map(({ label, count, color }) => (
                <div key={label}>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{label}</span>
                    <span>{count} ({stats.total > 0 ? Math.round((count / stats.total) * 100) : 0}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>
          )}
        </div>
      </div>
    </div>
  )
}
