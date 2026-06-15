import type { AiStatus, ValidationStatus, ReviewStatus } from '@fc/shared'

const AI_STATUS: Record<AiStatus, { label: string; cls: string }> = {
  correct:    { label: 'ถูกต้อง',    cls: 'bg-green-100 text-green-800' },
  missing:    { label: 'ขาดข้อมูล', cls: 'bg-gray-100 text-gray-600' },
  suspicious: { label: 'น่าสงสัย',  cls: 'bg-yellow-100 text-yellow-800' },
  incorrect:  { label: 'ไม่ถูกต้อง', cls: 'bg-red-100 text-red-700' },
}

const VALIDATION_STATUS: Record<ValidationStatus, { label: string; cls: string }> = {
  correct:    { label: 'ถูกต้อง',    cls: 'bg-green-100 text-green-800' },
  missing:    { label: 'ขาดข้อมูล', cls: 'bg-gray-100 text-gray-600' },
  suspicious: { label: 'น่าสงสัย',  cls: 'bg-yellow-100 text-yellow-800' },
  suggested:  { label: 'แนะนำ',     cls: 'bg-blue-100 text-blue-800' },
  incorrect:  { label: 'ไม่ถูกต้อง', cls: 'bg-red-100 text-red-700' },
}

const REVIEW_STATUS: Record<ReviewStatus, { label: string; cls: string }> = {
  pending:  { label: 'รอตรวจ',     cls: 'bg-orange-100 text-orange-700' },
  verified: { label: 'ยืนยันแล้ว', cls: 'bg-green-100 text-green-800' },
  flagged:  { label: 'ต้องแก้',    cls: 'bg-red-100 text-red-700' },
}

export function AiStatusBadge({ status }: { status: AiStatus }) {
  const { label, cls } = AI_STATUS[status] ?? AI_STATUS.missing
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
}

export function ValidationStatusBadge({ status }: { status: ValidationStatus }) {
  const { label, cls } = VALIDATION_STATUS[status] ?? VALIDATION_STATUS.missing
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const { label, cls } = REVIEW_STATUS[status] ?? REVIEW_STATUS.pending
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>
}
