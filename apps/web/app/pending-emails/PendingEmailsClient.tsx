'use client'

import { useState, useEffect } from 'react'

interface PendingEmail {
  order_id: string
  batch_code: string
  ae_email: string
  company: string
  ae: string
  created_at: string
  missing_fields: string[]
  purposes: string[]
  subject: string
  body: string
}

interface BatchEmail {
  batch_code: string
  ae_email: string
  ae: string
  purposes: string[]
  purposeSummary: string
  total_orders: number
  subject: string
  body: string
}

interface ApiResponse {
  emails: PendingEmail[]
  batchEmails: BatchEmail[]
  byPurpose: Record<string, number>
  total: number
}

const PURPOSE_COLOR: Record<string, string> = {
  'พิกัด GPS':          'bg-rose-100 text-rose-800 border-rose-300',
  'แพ็กเกจ / ความเร็ว': 'bg-amber-100 text-amber-800 border-amber-300',
  'ผู้ประสานงาน':        'bg-purple-100 text-purple-800 border-purple-300',
  'ประเภทวงจร':          'bg-blue-100 text-blue-800 border-blue-300',
  'อื่นๆ':              'bg-gray-100 text-gray-700 border-gray-300',
}

// ── Consolidated batch card (ทั้งหมด view) ─────────────────────────────────────

function BatchEmailCard({ be, expanded, onToggle }: {
  be: BatchEmail
  expanded: boolean
  onToggle: () => void
}) {
  const [sent, setSent] = useState(false)

  const handleSend = () => {
    window.open(
      `mailto:${encodeURIComponent(be.ae_email)}?subject=${encodeURIComponent(be.subject)}&body=${encodeURIComponent(be.body)}`
    )
    setSent(true)
  }

  return (
    <div className={`rounded-2xl border overflow-hidden transition-shadow ${expanded ? 'border-[#185FA5] shadow-md' : 'border-gray-200 hover:border-gray-300'}`}>
      <button onClick={onToggle} className="w-full text-left px-5 py-4 bg-white flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 font-mono">{be.batch_code}</span>
            <span className="text-xs text-gray-400">{be.ae_email || 'ไม่มีอีเมล AE'}</span>
            {sent && <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">ส่งแล้ว</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {be.purposes.map(p => (
              <span key={p} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PURPOSE_COLOR[p] ?? PURPOSE_COLOR['อื่นๆ']}`}>
                {p}
              </span>
            ))}
            <span className="text-xs text-gray-400 ml-1">· {be.total_orders} sites</span>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-white">
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-gray-600 flex-shrink-0">ถึง:</span>
              <span className="text-gray-800">{be.ae_email || '(ไม่มีอีเมล AE)'}</span>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="font-medium text-gray-600 flex-shrink-0">Subject:</span>
              <span className="text-gray-800">{be.subject}</span>
            </div>
            <div className="border-t border-gray-200 pt-2">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{be.body}</pre>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSend}
              className="text-sm px-4 py-2 rounded-lg bg-[#185FA5] text-white hover:bg-blue-700 transition-colors"
            >
              {sent ? 'ส่งซ้ำ' : 'เปิดอีเมล'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Individual order card (purpose-filtered view) ─────────────────────────────

function OrderEmailCard({ email, expanded, onToggle }: {
  email: PendingEmail
  expanded: boolean
  onToggle: () => void
}) {
  const [sent, setSent] = useState(false)

  const handleSend = () => {
    window.open(
      `mailto:${encodeURIComponent(email.ae_email)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`
    )
    setSent(true)
  }

  return (
    <div className={`rounded-xl border transition-shadow ${expanded ? 'border-[#185FA5] shadow-sm' : 'border-gray-200 hover:border-gray-300'} bg-white`}>
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 truncate">{email.company}</span>
            {sent && <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">ส่งแล้ว</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {email.purposes.map(p => (
              <span key={p} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PURPOSE_COLOR[p] ?? PURPOSE_COLOR['อื่นๆ']}`}>
                {p}
              </span>
            ))}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-gray-600 flex-shrink-0">ถึง:</span>
              <span className="text-gray-800">{email.ae_email || '(ไม่มีอีเมล AE)'}</span>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="font-medium text-gray-600 flex-shrink-0">Subject:</span>
              <span className="text-gray-800">{email.subject}</span>
            </div>
            <div className="border-t border-gray-200 pt-2">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{email.body}</pre>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSend}
              className="text-sm px-4 py-2 rounded-lg bg-[#185FA5] text-white hover:bg-blue-700 transition-colors"
            >
              {sent ? 'ส่งซ้ำ' : 'เปิดอีเมล'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Batch section for purpose-filtered view ───────────────────────────────────

function BatchGroup({ batchCode, emails, expandedId, onToggle }: {
  batchCode: string
  emails: PendingEmail[]
  expandedId: string | null
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  const purposes = [...new Set(emails.flatMap(e => e.purposes))]

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 font-mono">{batchCode}</span>
            <span className="text-xs text-gray-400">{emails[0]?.ae_email || 'ไม่มีอีเมล AE'}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {purposes.map(p => (
              <span key={p} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PURPOSE_COLOR[p] ?? PURPOSE_COLOR['อื่นๆ']}`}>
                {p}
              </span>
            ))}
            <span className="text-xs text-gray-400 ml-1">· {emails.length} sites</span>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 py-3 space-y-2 bg-white">
          {emails.map(email => (
            <OrderEmailCard
              key={email.order_id}
              email={email}
              expanded={expandedId === email.order_id}
              onToggle={() => onToggle(email.order_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PendingEmailsClient() {
  const [data, setData]             = useState<ApiResponse | null>(null)
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState<string>('ทั้งหมด')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/pending-emails')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-gray-400">กำลังโหลด…</div>
      </div>
    )
  }

  if (!data || data.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <svg className="w-12 h-12 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm font-medium text-gray-500">ไม่มีอีเมลที่ต้องส่ง</p>
        <p className="text-xs text-gray-400">ทุก order มีข้อมูลครบหรือไม่มีสถานะรอ AE</p>
      </div>
    )
  }

  const toggleExpand = (id: string) =>
    setExpandedId(cur => cur === id ? null : id)

  // For purpose-filtered view: group per-order emails by batch
  const filteredOrders = data.emails.filter(e => e.purposes.includes(filter))
  const batchGroupMap = new Map<string, PendingEmail[]>()
  for (const e of filteredOrders) {
    if (!batchGroupMap.has(e.batch_code)) batchGroupMap.set(e.batch_code, [])
    batchGroupMap.get(e.batch_code)!.push(e)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">อีเมลที่ต้องส่ง</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {data.total} คำสั่งรอข้อมูลจาก AE · {data.batchEmails.length} batch
        </p>
      </div>

      {/* Purpose filter chips */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { setFilter('ทั้งหมด'); setExpandedId(null) }}
          className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
            filter === 'ทั้งหมด'
              ? 'bg-[#185FA5] text-white border-[#185FA5]'
              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
          }`}
        >
          ทั้งหมด <span className="ml-1 text-xs opacity-75">({data.batchEmails.length} batch)</span>
        </button>
        {Object.entries(data.byPurpose).map(([purpose, count]) => {
          const cls    = PURPOSE_COLOR[purpose] ?? PURPOSE_COLOR['อื่นๆ']
          const active = filter === purpose
          return (
            <button
              key={purpose}
              onClick={() => { setFilter(f => f === purpose ? 'ทั้งหมด' : purpose); setExpandedId(null) }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                active ? cls + ' ring-2 ring-offset-1 ring-current' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {purpose}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${active ? 'bg-white/60' : 'bg-gray-100'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ทั้งหมด → one consolidated email per batch */}
      {filter === 'ทั้งหมด' && (
        <div className="space-y-4">
          {data.batchEmails.map(be => (
            <BatchEmailCard
              key={be.batch_code}
              be={be}
              expanded={expandedId === be.batch_code}
              onToggle={() => toggleExpand(be.batch_code)}
            />
          ))}
        </div>
      )}

      {/* Purpose selected → per-order cards grouped by batch */}
      {filter !== 'ทั้งหมด' && (
        <div className="space-y-4">
          {Array.from(batchGroupMap.entries()).map(([code, emails]) => (
            <BatchGroup
              key={code}
              batchCode={code}
              emails={emails}
              expandedId={expandedId}
              onToggle={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}
