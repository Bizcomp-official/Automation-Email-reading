import type { AiStatus, ValidationStatus, ReviewStatus } from '@fc/shared'

const AI_STATUS: Record<AiStatus, { label: string; desc: string; cls: string }> = {
  correct:    { label: 'ถูกต้อง',     desc: 'AI extracted all fields with high confidence',         cls: 'bg-green-100 text-green-800' },
  missing:    { label: 'ขาดข้อมูล',  desc: 'One or more required fields not found in the email',   cls: 'bg-red-100 text-red-700' },
  suspicious: { label: 'น่าสงสัย',   desc: 'AI found values but some may be wrong — review needed', cls: 'bg-yellow-100 text-yellow-800' },
  incorrect:  { label: 'ไม่ถูกต้อง', desc: 'AI detected one or more values are likely incorrect',   cls: 'bg-red-100 text-red-700' },
}

const VALIDATION_STATUS: Record<ValidationStatus, { label: string; desc: string; cls: string }> = {
  correct:    { label: 'ถูกต้อง',     desc: 'Value matches expected format and content',            cls: 'bg-green-100 text-green-800' },
  missing:    { label: 'ขาดข้อมูล',  desc: 'Field absent from the source data',                    cls: 'bg-red-100 text-red-700' },
  suspicious: { label: 'น่าสงสัย',   desc: 'Value present but may be wrong — verify before use',   cls: 'bg-yellow-100 text-yellow-800' },
  suggested:  { label: 'AI แนะนำ',   desc: 'AI inferred this value — not explicitly stated',        cls: 'bg-blue-100 text-blue-800' },
  incorrect:  { label: 'ไม่ถูกต้อง', desc: 'Value does not match expected format or content',       cls: 'bg-red-100 text-red-700' },
}

const REVIEW_STATUS: Record<ReviewStatus, { label: string; desc: string; cls: string }> = {
  pending:  { label: 'รอตรวจ',      desc: 'Awaiting manual review',                cls: 'bg-orange-100 text-orange-700' },
  verified: { label: 'ยืนยันแล้ว',  desc: 'Reviewed and confirmed correct',         cls: 'bg-green-100 text-green-800' },
  flagged:  { label: 'ต้องแก้ไข',   desc: 'Marked for correction or follow-up',     cls: 'bg-red-100 text-red-700' },
}

export function AiStatusBadge({ status, showDesc }: { status: AiStatus; showDesc?: boolean }) {
  const { label, desc, cls } = AI_STATUS[status] ?? AI_STATUS.missing
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
      {showDesc && <span className="text-xs text-gray-400 leading-tight">{desc}</span>}
    </span>
  )
}

export function ValidationStatusBadge({ status, showDesc }: { status: ValidationStatus; showDesc?: boolean }) {
  const { label, desc, cls } = VALIDATION_STATUS[status] ?? VALIDATION_STATUS.missing
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
      {showDesc && <span className="text-xs text-gray-400 leading-tight">{desc}</span>}
    </span>
  )
}

export function ReviewStatusBadge({ status, showDesc }: { status: ReviewStatus; showDesc?: boolean }) {
  const { label, desc, cls } = REVIEW_STATUS[status] ?? REVIEW_STATUS.pending
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
      {showDesc && <span className="text-xs text-gray-400 leading-tight">{desc}</span>}
    </span>
  )
}
