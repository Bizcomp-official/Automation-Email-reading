export type BatchSource = 'email' | 'rpa' | 'manual'
export type BatchStatus = 'processing' | 'done' | 'error'
export type AiStatus = 'correct' | 'missing' | 'suspicious' | 'incorrect'
export type ValidationStatus = 'correct' | 'missing' | 'suspicious' | 'incorrect' | 'suggested'
export type ReviewStatus = 'pending' | 'verified' | 'flagged'
export type InputFormat = 'google_maps_link' | 'lat_long' | 'plain_text'

export interface Batch {
  id: string
  batch_code: string
  source: BatchSource
  email_subject: string | null
  email_from: string | null
  received_at: string | null
  status: BatchStatus
  created_at: string
  orders?: Order[]
}

export interface Order {
  id: string
  batch_id: string
  seq: number
  customer_name: string | null
  company_name: string | null
  circuit_order_type: string | null
  old_circuit: string | null
  product_package: string | null
  speed: string | null
  store_code: string | null
  branch_name: string | null
  coordinator_name: string | null
  coordinator_phone: string | null
  source_ref: string | null
  customer_note: string | null
  ai_status: AiStatus
  created_at: string
  address?: Address
  field_validations?: FieldValidation[]
  review?: Review
}

export interface Address {
  id: string
  order_id: string
  house_no: string | null
  moo: string | null
  building: string | null
  floor: string | null
  room: string | null
  soi: string | null
  road: string | null
  subdistrict: string | null
  district: string | null
  province: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  input_format: InputFormat | null
  geocode_confidence: number | null
}

export interface FieldValidation {
  id: string
  order_id: string
  field_name: string
  value: string | null
  status: ValidationStatus
  ai_note: string | null
  confidence: number | null
}

export interface Review {
  id: string
  order_id: string
  is_status: ReviewStatus
  reviewer: string | null
  note: string | null
  reviewed_at: string | null
}

// API response shapes
export interface OrderListItem {
  id: string
  batch_id: string
  batch_code: string
  seq: number
  customer_name: string | null
  company_name: string | null
  ai_status: AiStatus
  created_at: string
  address_summary: string | null
  province: string | null
  review_status: ReviewStatus
  email_from: string | null
  customer_note: string | null
}

export interface SummaryStats {
  total: number
  verified: number
  pending: number
  flagged: number
  avg_confidence: number | null
}

// Claude AI extraction shapes
export interface ClaudeAddressField {
  house_no?: string
  moo?: string
  building?: string
  floor?: string
  room?: string
  soi?: string
  road?: string
  subdistrict?: string
  district?: string
  province?: string
  postcode?: string
  latitude?: number | string | null
  longitude?: number | string | null
  input_format?: InputFormat
  is_office_known_location?: boolean
}

export interface ClaudeFieldValidation {
  field_name: string
  value: string | null
  status: ValidationStatus
  ai_note: string
  confidence: number
  corrected_value?: string | null
}

export interface ClaudeOrder {
  source_ref: string
  customer_name?: string
  company_name?: string
  circuit_order_type?: string
  old_circuit?: string
  product_package?: string
  speed?: string
  store_code?: string
  branch_name?: string
  coordinator_name?: string
  coordinator_phone?: string
  customer_note?: string | null
  address: ClaudeAddressField
  fields: ClaudeFieldValidation[]
  ai_status: AiStatus
}

export interface ClaudeExtractionResult {
  orders: ClaudeOrder[]
}
