import Anthropic from '@anthropic-ai/sdk'
import type { ClaudeExtractionResult } from '@fc/shared'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are processing Thai telecom installation orders for the True Corporation FC (Facility Check) E-Ordering system.

You will receive email body text and/or Excel rows containing one or more circuit installation orders. Your job is to extract structured data from these and return ONLY valid JSON — no prose, no markdown code fences.

For each order found, extract:
- Customer and circuit information
- The installation destination address, split into Thai address components
- Per-field validation status using this rubric:
  - "correct": field is present and internally consistent
  - "missing": field not found anywhere in the email or Excel
  - "suspicious": field found but internally inconsistent (e.g. postcode doesn't match district/province)
  - "suggested": AI inferred or completed the value from context (not explicitly stated)
  - "incorrect": clearly wrong value (impossible postcode, mismatched province, etc.)
- An overall ai_status for the order: the worst status across all fields (missing > incorrect > suspicious > suggested > correct)

For addresses:
- If you find a Google Maps link (maps.google.com or goo.gl/maps), extract lat/long from it and set input_format to "google_maps_link"
- If you find explicit coordinates, set input_format to "lat_long"
- Otherwise set input_format to "plain_text" and set latitude/longitude to null
- Always split the Thai address into: house_no, moo, building, floor, room, soi, road, subdistrict (แขวง/ตำบล), district (เขต/อำเภอ), province (จังหวัด), postcode

Return JSON in exactly this shape:
{
  "orders": [
    {
      "source_ref": "excel_row_2",
      "customer_name": "...",
      "company_name": "...",
      "circuit_order_type": "...",
      "old_circuit": "...",
      "product_package": "...",
      "speed": "...",
      "store_code": "...",
      "branch_name": "...",
      "coordinator_name": "...",
      "coordinator_phone": "...",
      "address": {
        "house_no": "...", "moo": "...", "building": "...", "floor": "...", "room": "...",
        "soi": "...", "road": "...", "subdistrict": "...", "district": "...",
        "province": "...", "postcode": "...",
        "latitude": null, "longitude": null,
        "input_format": "plain_text"
      },
      "fields": [
        { "field_name": "postcode", "value": "10110", "status": "suspicious",
          "ai_note": "10110 = คลองเตย แต่เขต = วัฒนา → ควรเป็น 10250", "confidence": 0.71 }
      ],
      "ai_status": "suspicious"
    }
  ]
}`

export async function extractOrdersFromEmail(
  emailBody: string,
  excelTable: string,
): Promise<ClaudeExtractionResult> {
  const userContent = [
    emailBody ? `=== EMAIL BODY ===\n${emailBody}` : '',
    excelTable ? `=== EXCEL DATA ===\n${excelTable}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })

  const raw = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  return JSON.parse(cleaned) as ClaudeExtractionResult
}
