import { GoogleGenAI } from '@google/genai'
import type { ClaudeExtractionResult } from '@fc/shared'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

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
• If a Google Maps URL is present, extract latitude and longitude from it.
• If explicit GPS coordinates appear, use them.

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
  latitude    — decimal degrees or null
  longitude   — decimal degrees or null
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

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) return raw.slice(start, end + 1)
  return raw.trim()
}

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

  const userContent = parts.join('\n\n')

  console.log('[gemini] sending to API — content length:', userContent.length, 'chars')
  console.log('[gemini] first 500 chars of input:\n', userContent.slice(0, 500))

  let response
  try {
    response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userContent,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 8192,
      },
    })
  } catch (err) {
    console.error('[gemini] API call threw:', String(err))
    throw new Error(`Gemini API call failed: ${String(err)}`)
  }

  const raw = response.text ?? ''

  console.log('[gemini] response length:', raw.length)
  console.log('[gemini] raw response:\n', raw)

  let result: ClaudeExtractionResult
  try {
    result = JSON.parse(extractJson(raw)) as ClaudeExtractionResult
  } catch (err) {
    console.error('[gemini] JSON parse failed. Raw was:\n', raw)
    throw new Error(`Gemini returned invalid JSON: ${String(err)}`)
  }

  console.log(`[gemini] extracted ${result.orders.length} order(s)`)
  result.orders.forEach((o, i) => {
    console.log(`  order[${i}] customer:"${o.customer_name}" ai_status:"${o.ai_status}"`)
    console.log(`  order[${i}] address:`, JSON.stringify(o.address, null, 2))
  })

  return result
}
