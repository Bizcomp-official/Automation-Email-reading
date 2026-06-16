import Anthropic from '@anthropic-ai/sdk'
import type { ClaudeExtractionResult, ClaudeOrder } from '@fc/shared'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Google Maps URL resolution ──────────────────────────────────────────────

const MAPS_URL_RE =
  /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps|maps\.google\.com)[^\s<>"')\]　​]*/gi

function extractCoordsFromUrl(url: string): { lat: string; lng: string } | null {
  let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: m[1], lng: m[2] }
  m = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: m[1], lng: m[2] }
  m = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m) return { lat: m[1], lng: m[2] }
  return null
}

async function resolveGoogleMapsUrls(text: string): Promise<string> {
  const urls = [...new Set(Array.from(text.matchAll(MAPS_URL_RE), (m) => m[0]))]
  if (urls.length === 0) return text

  let result = text
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(6000),
        })
        const finalUrl = res.url
        const coords = extractCoordsFromUrl(finalUrl) ?? extractCoordsFromUrl(url)
        if (coords) {
          const annotation = ` [พิกัด GPS ที่สกัดจาก Google Maps: latitude=${coords.lat}, longitude=${coords.lng}]`
          result = result.replace(url, url + annotation)
          console.log(`[maps] resolved ${url} → lat=${coords.lat}, lng=${coords.lng}`)
        } else {
          console.log(`[maps] resolved ${url} but no coords found in: ${finalUrl}`)
        }
      } catch (err) {
        console.warn(`[maps] could not resolve ${url}:`, String(err))
      }
    }),
  )
  return result
}

// ── Geocoding ─────────────────────────────────────────────────────────────

interface GoogleGeocodeResponse {
  status: string
  results: Array<{ geometry: { location: { lat: number; lng: number } }; types: string[] }>
}
interface NominatimResult { lat: string; lon: string; importance: number }

type Coords = { lat: number; lng: number; source: string }

/** Build a ranked list of address query strings, most-specific first. */
function buildAddressQueries(addr: NonNullable<ClaudeOrder['address']>): string[] {
  const houseRoad = [
    addr.house_no,
    addr.soi    ? `ซอย${addr.soi}`  : null,
    addr.road   ? `ถนน${addr.road}` : null,
  ].filter(Boolean).join(' ')

  const adminArea = [addr.subdistrict, addr.district, addr.province].filter(Boolean).join(' ')
  const postcode  = addr.postcode ?? ''

  const q1 = [houseRoad, adminArea, postcode, 'Thailand'].filter(Boolean).join(' ')   // full
  const q2 = [houseRoad, adminArea, 'Thailand'].filter(Boolean).join(' ')             // no postcode
  const q3 = [adminArea, postcode, 'Thailand'].filter(Boolean).join(' ')             // admin+postcode
  const q4 = [adminArea, 'Thailand'].filter(Boolean).join(' ')                       // admin only

  return [...new Set([q1, q2, q3, q4])].filter(
    (q) => q.replace('Thailand', '').trim().length > 2,
  )
}

/** Primary geocoder: Google Maps Geocoding API (accurate, needs GOOGLE_MAPS_API_KEY). */
async function geocodeWithGoogle(
  addr: NonNullable<ClaudeOrder['address']>,
): Promise<Coords | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return null

  const queries = buildAddressQueries(addr)

  for (const q of queries) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(q)}&key=${key}&language=th&region=TH&components=country:TH`
      const res  = await fetch(url, { signal: AbortSignal.timeout(7000) })
      const data = (await res.json()) as GoogleGeocodeResponse

      if (data.status === 'OK' && data.results.length > 0) {
        const { lat, lng } = data.results[0].geometry.location
        console.log(`[geocode/google] "${q}" → lat=${lat}, lng=${lng}`)
        return { lat, lng, source: 'Google Maps Geocoding API' }
      }
      console.log(`[geocode/google] no result for "${q}" (status: ${data.status})`)
    } catch (err) {
      console.warn(`[geocode/google] error for "${q}":`, String(err))
    }
  }
  return null
}

/** Fallback geocoder: OpenStreetMap Nominatim (free, slightly lower accuracy for Thai addresses). */
async function geocodeWithNominatim(
  addr: NonNullable<ClaudeOrder['address']>,
): Promise<Coords | null> {
  const queries = buildAddressQueries(addr)

  for (const q of queries) {
    try {
      // 1. Try structured search first (better precision)
      if (addr.subdistrict || addr.district || addr.province) {
        const street  = [addr.house_no, addr.soi && `ซอย${addr.soi}`, addr.road && `ถนน${addr.road}`].filter(Boolean).join(' ')
        const params  = new URLSearchParams({
          format: 'json', limit: '3', countrycodes: 'th', addressdetails: '0',
          ...(street             && { street }),
          ...(addr.subdistrict   && { suburb: addr.subdistrict }),
          ...(addr.district      && { city: addr.district }),
          ...(addr.province      && { state: addr.province }),
          ...(addr.postcode      && { postalcode: addr.postcode }),
          country: 'Thailand',
        })
        const sRes  = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          headers: { 'User-Agent': 'FC-Address-Intelligence/1.0 (True Corporation IS)' },
          signal: AbortSignal.timeout(7000),
        })
        const sData = (await sRes.json()) as NominatimResult[]
        // Pick highest-importance result
        const best = sData.sort((a, b) => b.importance - a.importance)[0]
        if (best) {
          const lat = parseFloat(best.lat), lng = parseFloat(best.lon)
          console.log(`[geocode/nominatim/structured] "${q}" → lat=${lat}, lng=${lng}`)
          return { lat, lng, source: 'OpenStreetMap Nominatim' }
        }
      }

      // 2. Free-text fallback
      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(q)}&format=json&limit=3&countrycodes=th`
      const res  = await fetch(url, {
        headers: { 'User-Agent': 'FC-Address-Intelligence/1.0 (True Corporation IS)' },
        signal: AbortSignal.timeout(7000),
      })
      const data = (await res.json()) as NominatimResult[]
      const best = data.sort((a, b) => b.importance - a.importance)[0]
      if (best) {
        const lat = parseFloat(best.lat), lng = parseFloat(best.lon)
        console.log(`[geocode/nominatim/freetext] "${q}" → lat=${lat}, lng=${lng}`)
        return { lat, lng, source: 'OpenStreetMap Nominatim' }
      }
      console.log(`[geocode/nominatim] no result for "${q}"`)
    } catch (err) {
      console.warn(`[geocode/nominatim] error for "${q}":`, String(err))
    }
  }
  return null
}

async function geocodeThaiAddress(
  addr: ClaudeOrder['address'],
): Promise<Coords | null> {
  if (!addr) return null
  return (await geocodeWithGoogle(addr)) ?? (await geocodeWithNominatim(addr))
}

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert data extraction assistant for True Corporation's FC (Facility Check) E-Ordering system used by Inside Sales staff.

Your job: read unstructured Thai telecom installation order data (email bodies, Excel rows in any format) and return structured JSON. The input has NO fixed schema — column names, language, and layout vary by sender. Use context, content, and reasoning to identify what each piece of data represents.

━━━ STEP 1: IDENTIFY ORDERS ━━━
Each order is one installation circuit. There may be one or many. Each order has a customer, a circuit type, and a destination address.

━━━ STEP 2: EXTRACT ADDRESS — THIS IS THE MOST CRITICAL PART ━━━
Every order MUST have a destination installation address. Search every column and every line of text.

An address column may be labelled anything: ที่อยู่, ที่อยู่ติดตั้ง, สถานที่ติดตั้ง, Address, Location,
ปลายทาง, สาขา, พิกัด, Site, Install Address, หรืออื่นๆ — or it may just be a text block in the email.

PHASE A — EXTRACT what is explicitly in the data:
• Parse every column value and every sentence in the email body.
• A single concatenated Thai string like
    "เลขที่ 99/9 หมู่ 3 ซอยเพชรเกษม 10 ถนนเพชรเกษม แขวงหลักสอง เขตบางแค กรุงเทพฯ 10160"
  must be split into its components.
• If columns are already split (บ้านเลขที่, ซอย, ถนน, แขวง, เขต, จังหวัด, ไปรษณีย์), use them directly.

COORDINATES — extract from the data if present, otherwise leave null (the system will geocode automatically):
• If the data contains a line like [พิกัด GPS ที่สกัดจาก Google Maps: latitude=X, longitude=Y],
  copy X and Y verbatim — character by character, no rounding.
• If a Google Maps URL appears with @lat,lng or ?q=lat,lng, extract those digits exactly.
• If a plain coordinate pair appears (e.g. "13.756789, 100.523456"), copy every digit exactly.
• If none of the above are present → set latitude and longitude to null. Do NOT guess or infer.
• input_format: "google_maps_link" when from a URL, "lat_long" when plain numbers, "plain_text" otherwise.

PHASE B — INFER what is missing using your knowledge of Thai geography:
Use your knowledge of Thailand's administrative divisions to complete any gaps:
• If you have subdistrict (แขวง/ตำบล) → you can usually determine district, province, and postcode.
• If you have district (เขต/อำเภอ) → you can usually determine province and narrow down postcode.
• If you have province → you know the region and likely postcode range.
• If you have postcode → you can verify or fill in subdistrict/district/province.
• Cross-check: Bangkok (กรุงเทพมหานคร) uses แขวง/เขต; provinces use ตำบล/อำเภอ.
• If a postcode doesn't match the district/province you found, flag it as "suspicious".

RULE: Never leave ALL address fields null. Even if the address is vague, fill what you can from
the data and infer the rest. Mark every inferred field as status "suggested" with a clear ai_note
explaining your reasoning (e.g. "อนุมานจากแขวงบางรัก → เขตบางรัก กรุงเทพมหานคร 10500").

Address fields to populate (null only if truly undetectable even by inference):
  house_no    — บ้านเลขที่ / เลขที่
  moo         — หมู่ที่ / หมู่
  building    — อาคาร / ตึก
  floor       — ชั้น
  room        — ห้อง
  soi         — ซอย
  road        — ถนน
  subdistrict — แขวง หรือ ตำบล
  district    — เขต หรือ อำเภอ
  province    — จังหวัด
  postcode    — รหัสไปรษณีย์ (5 หลัก)
  latitude    — decimal degrees, full precision from source, or null
  longitude   — decimal degrees, full precision from source, or null
  input_format — "google_maps_link" | "lat_long" | "plain_text"

━━━ STEP 3: VALIDATE EACH FIELD ━━━
For every significant field (including each address component), add an entry to the "fields" array:
  "correct"    — explicitly in the data and internally consistent
  "missing"    — genuinely absent and could not be inferred
  "suspicious" — present but inconsistent (e.g. postcode ≠ province, or district ≠ province)
  "suggested"  — not in the data, but inferred by AI from Thai geographic knowledge; ai_note MUST explain
  "incorrect"  — clearly wrong (impossible postcode, wrong province for that district, etc.)

Overall ai_status for the ORDER must be one of: "correct" | "missing" | "suspicious" | "incorrect"
  — "suggested" is NOT valid for ai_status (it is only valid inside the fields array).
  If the worst field status is "suggested", set ai_status to "suspicious".
Priority: missing > incorrect > suspicious > suggested→suspicious > correct

━━━ OUTPUT FORMAT — CRITICAL ━━━
Your entire response must be ONLY the JSON object below — no preamble, no explanation,
no markdown outside the braces, no "I'll analyze..." text. Start your reply with { and end with }.

{
  "orders": [
    {
      "source_ref": "excel_row_1",
      "customer_name": "...",
      "company_name": "...",
      "circuit_order_type": "...",
      "old_circuit": null,
      "product_package": "...",
      "speed": "...",
      "store_code": null,
      "branch_name": "...",
      "coordinator_name": "...",
      "coordinator_phone": "...",
      "address": {
        "house_no": "99/9",
        "moo": "3",
        "building": null,
        "floor": null,
        "room": null,
        "soi": "เพชรเกษม 10",
        "road": "เพชรเกษม",
        "subdistrict": "หลักสอง",
        "district": "บางแค",
        "province": "กรุงเทพมหานคร",
        "postcode": "10160",
        "latitude": null,
        "longitude": null,
        "input_format": "plain_text"
      },
      "fields": [
        { "field_name": "house_no", "value": "99/9", "status": "correct", "ai_note": "", "confidence": 0.95 },
        { "field_name": "subdistrict", "value": "หลักสอง", "status": "correct", "ai_note": "", "confidence": 0.9 },
        { "field_name": "postcode", "value": "10160", "status": "correct", "ai_note": "", "confidence": 0.95 }
      ],
      "ai_status": "correct"
    }
  ]
}`

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw.trim()
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function extractOrdersFromEmail(
  emailBody: string,
  excelRows: string,
): Promise<ClaudeExtractionResult> {
  const parts: string[] = []

  if (emailBody?.trim()) {
    parts.push(`=== EMAIL BODY ===\n${emailBody.trim()}`)
  }
  if (excelRows?.trim()) {
    parts.push(`=== EXCEL ATTACHMENT (each row shown with column name: value) ===\n${excelRows.trim()}`)
  }

  if (parts.length === 0) {
    throw new Error('No content to extract from — email body and Excel are both empty')
  }

  const rawContent = parts.join('\n\n')

  // Step 1: resolve any Google Maps URLs → inject coords as plain text for Claude
  const userContent = await resolveGoogleMapsUrls(rawContent)

  console.log('[claude] sending to API — content length:', userContent.length, 'chars')
  console.log('[claude] first 500 chars of input:\n', userContent.slice(0, 500))

  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })
  } catch (err) {
    console.error('[claude] API call threw:', String(err))
    throw new Error(`Claude API call failed: ${String(err)}`)
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''

  console.log('[claude] response length:', raw.length)
  console.log('[claude] raw response:\n', raw)

  let result: ClaudeExtractionResult
  try {
    result = JSON.parse(extractJson(raw)) as ClaudeExtractionResult
  } catch (err) {
    console.error('[claude] JSON parse failed. Raw was:\n', raw)
    throw new Error(`Claude returned invalid JSON: ${String(err)}`)
  }

  console.log(`[claude] extracted ${result.orders.length} order(s)`)

  // Step 2: for any order still missing lat/lng, geocode via Nominatim OSM
  for (const order of result.orders) {
    const addr = order.address
    if (!addr) continue

    const hasCoords = addr.latitude != null && addr.longitude != null
    if (hasCoords) {
      console.log(`  [geocode] order "${order.customer_name}" already has coords — skipping`)
      continue
    }

    console.log(`  [geocode] order "${order.customer_name}" has no coords — geocoding address...`)
    const coords = await geocodeThaiAddress(addr)
    if (coords) {
      addr.latitude  = coords.lat
      addr.longitude = coords.lng
      const note = `geocoded จากที่อยู่ผ่าน ${coords.source}`
      const latField = order.fields?.find((f) => f.field_name === 'latitude')
      const lngField = order.fields?.find((f) => f.field_name === 'longitude')
      if (latField) { latField.value = String(coords.lat); latField.status = 'suggested'; latField.ai_note = note }
      if (lngField) { lngField.value = String(coords.lng); lngField.status = 'suggested'; lngField.ai_note = note }
    } else {
      console.warn(`  [geocode] could not resolve coords for order "${order.customer_name}"`)
    }

    console.log(`  order[...] customer:"${order.customer_name}" ai_status:"${order.ai_status}"`)
    console.log(`  order[...] address:`, JSON.stringify(addr, null, 2))
  }

  return result
}
