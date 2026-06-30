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

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert data-extraction assistant for True Corporation's FC (Facility Check)
E-Ordering system. You read unstructured Thai telecom installation orders (email bodies,
Excel rows in any format, or an email body PLUS attachments) and return STRICT JSON.

The input has no fixed schema. Use reasoning to identify what each piece of data is — but
follow the hard rules below exactly. These rules exist to fix real, observed failures.

═══════════════════════════════════════════════════════════════════════
HARD RULE 0 — NEVER FABRICATE. (most important)
═══════════════════════════════════════════════════════════════════════
• Every value you output MUST be traceable to the input. If a value is not present in the
  data and cannot be inferred from Thai GEOGRAPHY (addresses only), output null.
• NEVER invent a person's name. customer_name, coordinator_name, company_name,
  branch_name may ONLY contain text that literally appears in the input. If absent → null.
• Geographic inference is the ONLY kind of guessing allowed (subdistrict/district/province/
  postcode from each other). Names, phones, packages, speeds, store codes are NEVER guessed.

═══════════════════════════════════════════════════════════════════════
HARD RULE 1 — IGNORE THE EMAIL SIGNATURE / FOOTER. It is NOT order data.
═══════════════════════════════════════════════════════════════════════
The sender is the AE / Inside Sales, not the customer. NEVER use any of the following as a
coordinator, phone, address, or note:
• The "From:" sender name and their phone/e-mail.
• "Best regards / Best Regard" blocks and the name/phone beneath them.
• Call-center lines (e.g. "True Business Call Center 1239"), iService URLs, payment/treasury
  e-mails, กสทช./Liveness boilerplate, "Company Holiday", "Vacation Leave".
• The True Corporation company address ("18 อาคาร ทรู ทาวเวอร์ … ห้วยขวาง 10310") — that is
  the SENDER's office, never the install site.
Strip these entirely before extracting.

═══════════════════════════════════════════════════════════════════════
HARD RULE 2 — BATCH-LEVEL vs ROW-LEVEL fields (email body + attachment)
═══════════════════════════════════════════════════════════════════════
This rule applies ONLY to a pure cover/header body (no order of its own). If the body itself
names a customer/address it is an ORDER (Step 1a), not just a header — extract it AND apply any
shared body context to the attachment rows. When an email body carries a project header and an
attachment carries the sites:
• BATCH-LEVEL (from the body/project line) applies to EVERY order: product_package, speed,
  circuit_order_type, the project/BU coordinator_name + coordinator_phone, customer_note.
  Example body line: "Check FAC Biz Fix IP 500/500Mbps" and "BU คุณจักริน ทรัพย์สินมั่นคง /T.0643028931"
  → product_package="Biz Fix IP", speed="500/500 Mbps", coordinator_name="คุณจักริน ทรัพย์สินมั่นคง",
    coordinator_phone="0643028931" — copied to ALL rows.
• ROW-LEVEL (from each attachment row): the address fields, coordinates, site/branch name.
• Do NOT leave coordinator null on every row just because the row has no name — inherit the
  batch BU contact. Only set null if NEITHER the row NOR the body has any contact.

═══════════════════════════════════════════════════════════════════════
HARD RULE 3 — circuit_order_type, product_package, speed are THREE SEPARATE fields
═══════════════════════════════════════════════════════════════════════
Never copy one into another. Definitions:
• circuit_order_type = the WORK type: one of ติดตั้งใหม่ / ย้าย / เปลี่ยนความเร็ว / ยกเลิก / ตรวจสอบ.
  For a new install / "Check FAC" / "สมัคร" → "ติดตั้งใหม่". This is NEVER a product name.
• product_package = the PLAN name only, e.g. "Biz Fix IP", "TRUE GIGATEX FTTx", "TRUE 5G Home".
  NEVER put a speed or "Mbps" here.
• speed = bandwidth, NORMALIZED to "NNN/NNN Mbps" (always keep the unit), e.g. "500/500 Mbps".
  A single value like "600Mbps" → "600 Mbps".
WRONG (observed): circuit_order_type="Biz Fix IP", product_package="500/500 Mbps". Do not do this.

═══════════════════════════════════════════════════════════════════════
HARD RULE 4 — PHONE normalization
═══════════════════════════════════════════════════════════════════════
Strip prefixes/labels ("T.", "Tel.", "โทร", "/", spaces). Keep digits and dashes only.
"T.0643028931" → "0643028931" (or "064-302-8931"). Pick ONE consistent format for the batch.

═══════════════════════════════════════════════════════════════════════
STEP 1 — IDENTIFY ORDERS (extract from EVERY source — do not drop any)
═══════════════════════════════════════════════════════════════════════
Orders can come from THREE places. Extract from ALL that apply, then ADD them together:
  (a) THE EMAIL BODY ITSELF — if the body names a customer and/or an install address
      (e.g. "ลูกค้าชื่อ คุณสมชาย ... ติดตั้งที่ 123/4 ..."), that body text IS an order. Extract it.
  (b) EVERY ROW of EVERY attachment (.xlsx/.csv) — one order per data row.
  (c) BOTH — a body order PLUS attachment rows. Extract the body order AND every row.

A body is "metadata-only" (contributes NO order of its own, only batch defaults per Rule 2)
ONLY when it is a pure cover note — a project header / totals / contacts with NO specific
customer or address of its own (e.g. a USO batch cover). If the body names even one customer
or address, it is an order and MUST appear in "orders".

NEVER drop the body order just because an attachment exists. Capture install instructions
(preferred time, access rules, call-ahead) in customer_note; null if none.

COUNTING RULE: orders.length MUST equal (orders found in the body) + (data rows across all
attachments). Example — body with 1 customer + an Excel with 2 rows = 3 orders, never 2.

═══════════════════════════════════════════════════════════════════════
STEP 2 — ADDRESS (most critical)
═══════════════════════════════════════════════════════════════════════
PHASE A — split what is explicitly present into: house_no, moo, building, floor, room, soi,
road, subdistrict (แขวง/ตำบล), district (เขต/อำเภอ), province, postcode.
• A concatenated string like "เลขที่ 99/9 หมู่ 3 ซอยเพชรเกษม 10 ถนนเพชรเกษม แขวงหลักสอง เขตบางแค กรุงเทพฯ 10160"
  MUST be fully decomposed — do NOT leave "หมู่ 3 …" sitting in a combined field. moo="3".
• If columns are already split, map them directly. Keep house_no even when moo is also present.
• Keep moo and postcode as TEXT (preserve leading zeros: "03", not 3).

COORDINATES — copy verbatim if present in the email (Google Maps URL @lat,lng or ?q=,
a "lat, lng" pair, or Lat/Long columns). Full precision, no rounding.
NEVER invent or look up coordinates.

If no coordinates are in the email, set latitude/longitude to null AND decide:
• "is_office_known_location": true  — the site is a well-known fixed office that the
  install team can find without GPS (e.g. site description contains "สำนักงาน", "ที่ทำการ",
  or is clearly a government/company head office whose address is unambiguous).
• "is_office_known_location": false — all other cases: schools, health stations (รพ.สต.),
  residences, community centres, or any site where GPS is needed to locate it.
  These MUST be flagged — the AE will be asked to provide coordinates.

Default to false when unsure.
input_format: "google_maps_link" | "lat_long" | "plain_text".

PHASE B — infer ONLY missing administrative address parts from Thai geography
(subdistrict↔district↔province↔postcode). Mark each inferred field status "suggested" with an
ai_note explaining the basis. RULE: never leave ALL address fields null.

═══════════════════════════════════════════════════════════════════════
STEP 3 — VALIDATE (this is where the current system fails — be strict)
═══════════════════════════════════════════════════════════════════════
For every significant field add a "fields" entry with: field_name, value, status, ai_note,
confidence, and corrected_value (the value it SHOULD be, or null).

Status decision table — apply in this exact order:
1. "missing"    — required field genuinely absent AND not inferable (e.g. only a province is
                  given, so district/subdistrict/postcode cannot be determined).
2. "incorrect"  — provably wrong. Use for:
                  · impossible postcode (not a real 5-digit Thai code, e.g. 99999),
                  · province that does NOT contain the given district (e.g. district หาดใหญ่ but
                    province เชียงใหม่ → province incorrect; corrected_value="สงขลา"),
                  · district that does not exist in the province,
                  · latitude outside ~5–21 or longitude outside ~97–106 (Thailand bounds) →
                    likely swapped; corrected_value = the swapped pair.
3. "suspicious" — present but inconsistent (NOT "missing"):
                  · postcode does not match the district/province (e.g. บางรัก with 10160 →
                    corrected_value="10500"; เชียงใหม่ with 53000 → "50200"),
                  · subdistrict not located in the stated district (สีลม under บางกะปิ →
                    corrected subdistrict "หัวหมาก" or district "บางรัก"),
                  · coordinates far (>~20 km) from the stated address → flag for recheck.
4. "suggested"  — value was not in the data but you inferred it from geography (Phase B).
5. "correct"    — explicitly present AND internally consistent.

──────────────────────────────────────────────────────────────────────
EXTRA VALIDATION CHECKS — apply ALL of them.
──────────────────────────────────────────────────────────────────────
(C1) POSTCODE ↔ DISTRICT must match — INCLUDING within Bangkok. Do not pass a Bangkok row
     just because the province is "กรุงเทพมหานคร". Check the postcode belongs to that เขต:
       · บางรัก=10500 · บางกะปิ=10240 · จตุจักร=10900 · ห้วยขวาง=10310 · สาทร=10120 ·
         วัฒนา=10110 · ปทุมวัน=10330 …  If district=บางรัก but postcode=10160 → SUSPICIOUS,
       corrected_value="10500". (10160 is บางแค, not บางรัก.)
(C2) SUBDISTRICT must belong to the DISTRICT. If แขวง is not a real แขวง of that เขต → SUSPICIOUS.
       e.g. แขวง=สีลม under เขต=บางกะปิ is impossible (สีลม is บางรัก; บางกะปิ has หัวหมาก/คลองจั่น)
       → corrected_value="หัวหมาก" (or flag district). Never pass this as correct.
(C3) BLANK REQUIRED ADDRESS FIELD is never "correct"/"พร้อมส่ง". If subdistrict/district/postcode
     is empty:
       · if you CAN infer it from the rest → fill it, status "suggested" (→ ต้องตรวจ),
       · if you CANNOT infer it → status "missing" (→ รอ AE).
     A row whose แขวง/เขต/ไปรษณีย์ is blank must NOT come out พร้อมส่ง.
(C4) SPARSE ROW: if only a province (or only a province + site name) is present and เขต/แขวง/
     postcode are all blank → ai_status "missing" (รอ AE). Province alone is not enough to install.
(C5) ALWAYS try to fill a blank แขวง/ตำบล from district+postcode before deciding. e.g. blank แขวง
     with เขต=ปากเกร็ด, 11120 → suggested "ปากเกร็ด". Do not leave it null if it is inferable.

DO NOT mark a postcode/province/coordinate inconsistency as "missing"/"รอ AE". An inconsistency
is "suspicious" or "incorrect", which routes to "ต้องตรวจ" (recheck) — NOT to "รอ AE".

Always populate corrected_value when status is incorrect/suspicious/suggested, so the reviewer
sees the fix (e.g. {"field_name":"postcode","value":"10160","status":"suspicious",
"corrected_value":"10500","ai_note":"10160 ไม่ใช่ของเขตบางรัก → 10500"}).

ORDER ai_status ∈ {correct, missing, suspicious, incorrect}. Take the WORST field status;
map "suggested"→"suspicious". Priority: missing > incorrect > suspicious > suggested→suspicious
> correct. (Export "สถานะ": correct→พร้อมส่ง, suggested/suspicious/incorrect→ต้องตรวจ,
missing→รอ AE.)

═══════════════════════════════════════════════════════════════════════
COMMON MISTAKES TO AVOID (all observed in a previous run — do NOT repeat)
═══════════════════════════════════════════════════════════════════════
✗ Inventing coordinator names → ALWAYS null if not in data (Rule 0).
✗ Using the AE's signature name/phone (e.g. "Preeyaporn Won", 086-555-0142) as the contact (Rule 1).
✗ circuit_order_type="Biz Fix IP" / product_package="500/500 Mbps" (Rule 3).
✗ Inconsistent speed ("500/500" vs "500/500 Mbps") → always "NNN/NNN Mbps".
✗ Leaving หมู่/house_no inside the combined address instead of splitting (Step 2A).
✗ Marking a postcode/coord mismatch as "รอ AE" → it is "ต้องตรวจ" (Step 3).
✗ Passing a province-vs-district mismatch as "พร้อมส่ง" → it is "incorrect" (Step 3).
✗ Passing a Bangkok row where postcode≠district (บางรัก 10160) as "พร้อมส่ง" → SUSPICIOUS (C1).
✗ Passing a subdistrict that isn't in the district (สีลม under บางกะปิ) as "พร้อมส่ง" → SUSPICIOUS (C2).
✗ Leaving แขวง/เขต/postcode BLANK and still returning "พร้อมส่ง" → must be ต้องตรวจ or รอ AE (C3/C4).
✗ Leaving a blank แขวง null when district+postcode make it inferable (C5).

═══════════════════════════════════════════════════════════════════════
FINAL SELF-CHECK (before you output)
═══════════════════════════════════════════════════════════════════════
1. Count orders in the BODY (B = customers/addresses described in the email text itself).
2. Count data ROWS across all attachments (R).
3. orders.length MUST equal B + R. If it is fewer, you dropped order(s) — most often the body
   order. Re-extract until they match.
4. Confirm no order was merged away and no attachment row was skipped.

═══════════════════════════════════════════════════════════════════════
OUTPUT FORMAT — your entire reply is ONLY this JSON. Start with { end with }. No prose.
═══════════════════════════════════════════════════════════════════════
{
  "orders": [
    {
      "source_ref": "attachment_row_1",
      "customer_name": null,
      "company_name": "รพ.สต.บ้านฝายแตก",
      "circuit_order_type": "ติดตั้งใหม่",
      "old_circuit": null,
      "product_package": "Biz Fix IP",
      "speed": "500/500 Mbps",
      "store_code": "FC26040825",
      "branch_name": "รพ.สต.บ้านฝายแตก",
      "coordinator_name": "คุณจักริน ทรัพย์สินมั่นคง",
      "coordinator_phone": "0643028931",
      "customer_note": "โทรแจ้งล่วงหน้าก่อนเข้าพื้นที่ และสะดวกเข้าช่วงเช้า",
      "address": {
        "house_no": null, "moo": "03", "building": "รพ.สต.บ้านฝายแตก", "floor": null,
        "room": null, "soi": null, "road": null, "subdistrict": "ลำพาน",
        "district": "เมืองกาฬสินธุ์", "province": "กาฬสินธุ์", "postcode": "46000",
        "latitude": "16.481545095", "longitude": "103.49260786", "input_format": "lat_long"
      },
      "fields": [],
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const BATCH_SIZE = 7 // rows per Claude call — Haiku 8192 tokens; Thai ~1 token/char; 7 rows leaves room for verbose output

function formatRawRows(rows: Record<string, unknown>[], startIndex: number): string {
  return rows
    .map((row, i) => {
      const pairs = Object.entries(row)
        .filter(([, v]) => v !== null && v !== '' && v !== undefined)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
      return `--- Row ${startIndex + i + 1} ---\n${pairs}`
    })
    .join('\n\n')
}

async function callClaude(userContent: string, batchLabel: string): Promise<ClaudeOrder[]> {
  console.log(`[claude/${batchLabel}] content length: ${userContent.length} chars`)

  let raw = ''
  let stopReason: string | null = null
  try {
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })
    const message = await stream.finalMessage()
    raw = message.content[0].type === 'text' ? message.content[0].text : ''
    stopReason = message.stop_reason
  } catch (err) {
    console.error(`[claude/${batchLabel}] API call threw:`, String(err))
    throw new Error(`Claude API call failed: ${String(err)}`)
  }

  if (stopReason === 'max_tokens') {
    console.warn(`[claude/${batchLabel}] response was truncated — reduce BATCH_SIZE`)
  }
  console.log(`[claude/${batchLabel}] response length: ${raw.length}`)

  let result: ClaudeExtractionResult
  try {
    result = JSON.parse(extractJson(raw)) as ClaudeExtractionResult
  } catch (err) {
    console.error(`[claude/${batchLabel}] JSON parse failed. Raw was:\n`, raw)
    throw new Error(`Claude returned invalid JSON: ${String(err)}`)
  }

  // Strip "correct" fields — buildCompleteValidations in route.ts fills them back in.
  // This prevents Claude's verbose output from inflating token counts and causing truncation.
  for (const order of result.orders) {
    if (order.fields) {
      order.fields = order.fields.filter((f) => f.status !== 'correct')
    }
  }

  console.log(`[claude/${batchLabel}] extracted ${result.orders.length} order(s)`)
  return result.orders
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function extractOrdersFromEmail(
  emailBody: string,
  excelRows: string,
  rawExcelRows?: Record<string, unknown>[],
): Promise<ClaudeExtractionResult> {
  if (!emailBody?.trim() && !excelRows?.trim()) {
    throw new Error('No content to extract from — email body and Excel are both empty')
  }

  const emailSection = emailBody?.trim()
    ? `=== EMAIL BODY ===\n${emailBody.trim()}`
    : ''

  // Resolve Google Maps URLs in the email body once (not per-batch)
  const resolvedEmailSection = emailSection ? await resolveGoogleMapsUrls(emailSection) : ''

  let allOrders: ClaudeOrder[]

  if (rawExcelRows && rawExcelRows.length > BATCH_SIZE) {
    // ── Batched path: split Excel rows into chunks ──
    const batches: Record<string, unknown>[][] = []
    for (let i = 0; i < rawExcelRows.length; i += BATCH_SIZE) {
      batches.push(rawExcelRows.slice(i, i + BATCH_SIZE))
    }
    console.log(`[claude] ${rawExcelRows.length} rows → ${batches.length} batch(es) of ${BATCH_SIZE}`)

    // Run up to 3 batches in parallel to cut wall-clock time
    const PARALLEL = 3
    const batchResults: ClaudeOrder[][] = new Array(batches.length)
    for (let i = 0; i < batches.length; i += PARALLEL) {
      const group = batches.slice(i, i + PARALLEL)
      await Promise.all(
        group.map(async (batch, j) => {
          const b = i + j
          const rowsText = formatRawRows(batch, b * BATCH_SIZE)
          const excelSection = `=== EXCEL ATTACHMENT (each row shown with column name: value) ===\n${rowsText}`
          const userContent = [resolvedEmailSection, excelSection].filter(Boolean).join('\n\n')
          batchResults[b] = await callClaude(userContent, `batch ${b + 1}/${batches.length}`)
        }),
      )
    }
    allOrders = batchResults.flat()
  } else {
    // ── Single call path ──
    const excelSection = excelRows?.trim()
      ? `=== EXCEL ATTACHMENT (each row shown with column name: value) ===\n${excelRows.trim()}`
      : ''
    const rawContent = [resolvedEmailSection, excelSection].filter(Boolean).join('\n\n')
    const userContent = await resolveGoogleMapsUrls(rawContent)
    allOrders = await callClaude(userContent, 'single')
  }

  console.log(`[claude] total extracted: ${allOrders.length} order(s)`)
  return { orders: allOrders }
}
