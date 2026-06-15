import type {
  Batch,
  Order,
  OrderListItem,
  SummaryStats,
  ReviewStatus,
} from '@fc/shared'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export async function uploadBatch(file: File): Promise<Batch & { orders: Order[] }> {
  const form = new FormData()
  form.append('email', file)
  const res = await fetch(`${BASE}/api/batches`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? res.statusText)
  }
  const data = await res.json()
  return data.batch ? { ...data.batch, orders: data.orders } : data
}

export async function getBatch(id: string): Promise<Batch & { orders: Order[] }> {
  return apiFetch(`/api/batches/${id}`)
}

export interface OrderListResponse {
  data: OrderListItem[]
  count: number
}

export async function listOrders(params: {
  q?: string
  status?: string
  from_date?: string
  to_date?: string
  limit?: number
  offset?: number
}): Promise<OrderListResponse> {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.status) qs.set('status', params.status)
  if (params.from_date) qs.set('from_date', params.from_date)
  if (params.to_date) qs.set('to_date', params.to_date)
  if (params.limit !== undefined) qs.set('limit', String(params.limit))
  if (params.offset !== undefined) qs.set('offset', String(params.offset))
  return apiFetch(`/api/orders?${qs}`)
}

export async function getOrder(id: string): Promise<Order> {
  return apiFetch(`/api/orders/${id}`)
}

export async function reviewOrder(
  id: string,
  payload: { is_status: ReviewStatus; note?: string },
): Promise<void> {
  await apiFetch(`/api/orders/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function getSummary(): Promise<SummaryStats> {
  return apiFetch('/api/summary')
}
