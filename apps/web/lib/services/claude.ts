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
  → product_package="Biz Fix IP", speed="500/500 Mbps", coordinator_name="จักริน ทรัพย์สินมั่นคง",
    coordinator_phone="0643028931" — copied to ALL rows.  (honorific คุณ stripped per Rule 5)
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
HARD RULE 5 — COORDINATOR NAME + PHONE (ผู้ประสานงาน / เบอร์ติดต่อ)
═══════════════════════════════════════════════════════════════════════
For EACH circuit/site output coordinator_name and coordinator_phone.

STEP 1 — Find the phone number:
Look near cues: ติดต่อ / โทร / เบอร์ / ผู้ประสานงาน / Tel / Mobile / contact.
A Thai mobile is 10 digits (0XX-XXX-XXXX or 0XXXXXXXXX).

STEP 2 — Anchor the NAME to that phone (this is the part that keeps failing):
The coordinator_name is the word(s) sitting BETWEEN the cue word and the phone number.
In "ติดต่อ นครินทร์ 089-202-8056" the token between ติดต่อ and the number is the name
→ "นครินทร์".
• A BARE Thai given name with NO honorific IS still a name. Do not require คุณ / นาย /
  นาง / น.ส. / Mr / Ms to be present. "นครินทร์" alone is a valid coordinator_name.
• If an honorific IS present, strip it before storing: "คุณนครินทร์" → "นครินทร์".
• The name is NOT the email sender, NOT anyone in Cc, and NOT the company name
  ("Mitsiam International Limited" is a company — never a coordinator_name).

STEP 3 — SELF-CHECK before returning (critical):
If coordinator_phone is NOT null but coordinator_name IS null → STOP.
Re-read the sentence containing that phone number. A phone almost never appears
without an adjacent name in these emails — the name is there; extract it.
Only return coordinator_name: null if, after re-reading, there is truly no name near
ANY phone number. Never invent a name.

MULTIPLE CIRCUITS — INHERIT:
If several circuits share one contact (e.g. two services at the same site), apply the
SAME coordinator to every circuit unless a different contact is explicitly stated for
a specific one.

── EXAMPLES ──────────────────────────────────────────────────────────
"ที่อยู่ บ. ตามนี้ครับ ติดต่อ นครินทร์ 089-202-8056"
  → coordinator_name="นครินทร์"  coordinator_phone="089-202-8056"

"โทรนัดล่วงหน้าก่อนเข้าพื้นที่ คุณสมชาย 081-234-5678"
  → coordinator_name="สมชาย"  coordinator_phone="081-234-5678"

"ผู้ประสานงาน: น.ส.วรรณา / 0912345678"
  → coordinator_name="วรรณา"  coordinator_phone="0912345678"

"BU จักริน ทรัพย์สินมั่นคง T.0643028931"
  → coordinator_name="จักริน ทรัพย์สินมั่นคง"  coordinator_phone="0643028931"

"Mitsiam International Limited, contact: Somchai Jaidee 090-111-2222"
  → coordinator_name="Somchai Jaidee"  coordinator_phone="090-111-2222"

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

customer_note — VERBATIM COPY RULE:
Copy the note text EXACTLY as it appears in the source email. Do NOT summarize,
rephrase, translate, or "clean up" the wording.
• Never convert or infer units. If the source says "เมตร", output "เมตร".
  Never swap เมตร↔บาท, ชั้น↔เดือน, or change any number's unit.
• Never add words not literally in the source (e.g. do not invent "เบิกได้",
  "เดือนแรก", "ต้องมี" unless those exact words appear).
• If the note is long, return the exact source substring — not a paraphrase.
SELF-CHECK: every number and its unit in your output must appear identically in
the source. If they don't match exactly, you paraphrased — redo verbatim.
Example source: "ห้อง server ที่ติดตั้งอยู่ที่ชั้น 15 ระยะเดินสายจากช่องชาร์ปที่บริเวณลิฟต์น่าจะอยู่ที่ไม่เกิน 100 เมตร"
Correct output : that exact sentence, unchanged.

SITE vs CIRCUIT — never duplicate a site:
One physical address = ONE SITE. Count sites by distinct address, never by product count.
When multiple products/packages appear at the SAME address, create ONE order per CIRCUIT
(each with its own product_package and speed), but ALL sharing the identical address block,
company_name, coordinator, and coordinator_phone.

CORRECT for "Corporate Internet 500Mbps AND Corporate Internet Biz 500Mbps at 175 Sathorn City Tower":
  order 1 → product_package="Corporate Internet",      speed="500/500 Mbps", address=175 Sathorn…
  order 2 → product_package="Corporate Internet Biz",  speed="500/500 Mbps", address=175 Sathorn…
  (same company, same address, same coordinator — different package only)

WRONG: duplicating the company into a second site with a different address just to hold the second product.
WRONG: collapsing both circuits into one order and dropping one product name.

product_package = the FULL product name from the email body ("Corporate Internet Biz"),
NEVER the subject-line shorthand ("Corpbiz", "Corpnet").

COUNTING RULE: orders.length = (circuits in body) + (Excel data rows).
Example — body with 2 circuits at 1 address + Excel with 2 rows = 4 orders total.

═══════════════════════════════════════════════════════════════════════
STEP 2 — ADDRESS (most critical)
═══════════════════════════════════════════════════════════════════════
HARD RULE — subdistrict / district transliteration FORBIDDEN:
If the source text has subdistrict or district in Roman/English script (e.g. "Tungmahamek",
"Sathorn"), copy it VERBATIM as-is. Do NOT attempt to convert Roman → Thai script.
The system resolves these fields from a postcode table after extraction.
Only output Thai script for subdistrict/district when the source text is ALREADY in Thai.

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
✗ Creating a second site (different address block) just to hold a second product — same address = same site, each circuit is its own order sharing that address (Step 1).
✗ Collapsing two circuits at the same address into one order and dropping one product name (Step 1).
✗ Using subject-line shorthands as product_package: "Corpbiz"→"Corporate Internet Biz", "Corpnet"→"Corporate Internet" (Step 1).
✗ Inventing coordinator names → ALWAYS null if not in data (Rule 0).
✗ Using the AE's signature name/phone (e.g. "Preeyaporn Won", 086-555-0142) as the contact (Rule 1).
✗ Using the company name ("Mitsiam International Limited") as coordinator_name — company ≠ person (Rule 5).
✗ Returning coordinator_phone with a number but coordinator_name=null — a phone without a name means you missed the name; re-read (Rule 5 Step 3).
✗ Requiring an honorific before accepting a name — bare Thai names like "นครินทร์" ARE valid coordinator_name values (Rule 5 Step 2).
✗ Keeping honorifics: "คุณนครินทร์" must be stored as "นครินทร์" (Rule 5 Step 2).
✗ circuit_order_type="Biz Fix IP" / product_package="500/500 Mbps" (Rule 3).
✗ Inconsistent speed ("500/500" vs "500/500 Mbps") → always "NNN/NNN Mbps".
✗ Transliterating Roman subdistrict/district to Thai (e.g. "Tungmahamek" → "ทุ่งมหาม​ेฬ") — output the Roman form verbatim; the system resolves it (Step 2A Hard Rule).
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
5. [SYSTEM NOTE] blocks are metadata injected by the pre-processor — they are NOT orders,
   NOT email body text, and MUST NOT add to the order count. Ignore them for counting.

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
      "coordinator_name": "จักริน ทรัพย์สินมั่นคง",
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

// ── Coordinator pre-extractor (regex, runs before Claude) ────────────────────
// Extracts the coordinator name and phone from the email body using pattern matching.
// The result is injected into every batch prompt so Claude never has to find it.

const PHONE_RE = /0\d[\d\-]{7,9}\d/g
const HONORIFIC_RE = /^(คุณ|ค\.|นาย|นาง(?:สาว)?|น\.ส\.|Mr\.?|Ms\.?|Miss\.?)\s*/u

function preExtractCoordinator(emailBody: string): { name: string | null; phone: string | null } {
  if (!emailBody) return { name: null, phone: null }

  console.log('[preExtract] body snippet:', JSON.stringify(emailBody.slice(0, 400)))

  const triggerRe = /(?:ติดต่อ|ผู้ประสานงาน|ประสานงาน|ผู้ดูแล|โทร(?:ศัพท์)?|เบอร์(?:ติดต่อ)?|contact|coordinator|Tel\.?|Phone|Mobile)\s*/iu

  const lines = emailBody.split(/\r?\n/)
  console.log('[preExtract] lines:', lines.length, '| phones found:', emailBody.match(PHONE_RE))

  // Strategy 1: trigger keyword + Thai name + phone on same line
  for (const line of lines) {
    const phoneMatch = line.match(PHONE_RE)
    if (!phoneMatch) continue
    if (!triggerRe.test(line)) {
      console.log('[preExtract] phone line (no trigger):', JSON.stringify(line))
      continue
    }
    const phone = phoneMatch[0].replace(/[^0-9\-]/g, '')
    const beforePhone = line.substring(0, line.indexOf(phoneMatch[0]))
    const afterTrigger = beforePhone.replace(triggerRe, '')
    const thaiWords = afterTrigger.trim().split(/\s+/).filter(w => /[฀-๿]/.test(w))
    console.log('[preExtract] S1 hit — beforePhone:', JSON.stringify(beforePhone), 'thaiWords:', thaiWords)
    if (thaiWords.length > 0) {
      const raw = thaiWords.slice(0, 3).join(' ')
      const name = raw.replace(HONORIFIC_RE, '').trim()
      if (name) return { name, phone }
    }
  }

  // Strategy 2: [Thai words] immediately before a phone number, any line
  const adjacentRe = /((?:[฀-๿]+\s+){1,3})(0\d[\d\-]{7,9}\d)/u
  for (const line of lines) {
    if (/Best\s*[Rr]egard|True\s*Business|Call\s*Center|iService|@true\b/i.test(line)) continue
    const m = line.match(adjacentRe)
    if (m) {
      const phone = m[2].replace(/[^0-9\-]/g, '')
      const raw = m[1].trim()
      const name = raw.replace(HONORIFIC_RE, '').trim()
      console.log('[preExtract] S2 hit — raw:', JSON.stringify(raw), '→ name:', name)
      if (name) return { name, phone }
    }
  }

  // Strategy 3: trigger on one line, name+phone on the NEXT line
  for (let i = 0; i < lines.length - 1; i++) {
    if (!triggerRe.test(lines[i])) continue
    const nextLine = lines[i + 1]
    const phoneMatch = nextLine.match(PHONE_RE)
    if (!phoneMatch) continue
    const phone = phoneMatch[0].replace(/[^0-9\-]/g, '')
    const beforePhone = nextLine.substring(0, nextLine.indexOf(phoneMatch[0]))
    const thaiWords = beforePhone.trim().split(/\s+/).filter(w => /[฀-๿]/.test(w))
    console.log('[preExtract] S3 hit — trigger line:', JSON.stringify(lines[i]), 'next:', JSON.stringify(nextLine), 'words:', thaiWords)
    if (thaiWords.length > 0) {
      const raw = thaiWords.slice(0, 3).join(' ')
      const name = raw.replace(HONORIFIC_RE, '').trim()
      if (name) return { name, phone }
    }
  }

  return { name: null, phone: null }
}

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

  const jsonStr = extractJson(raw)
  if (!jsonStr.startsWith('{')) {
    // Model returned prose (e.g. asking for more info) — email body was empty/malformed
    console.error(`[claude/${batchLabel}] model returned prose instead of JSON. Raw:\n`, raw.slice(0, 400))
    throw new Error(
      'อีเมลนี้ไม่มีเนื้อหาที่อ่านได้ (body ว่างหรือเป็น HTML ที่ parse ไม่ได้) — กรุณาลองส่งออกเป็น .eml ใหม่',
    )
  }
  let result: ClaudeExtractionResult
  try {
    result = JSON.parse(jsonStr) as ClaudeExtractionResult
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

  // Pre-extract coordinator from the email body with regex (reliable, not Claude-dependent)
  const preCoord = preExtractCoordinator(emailBody ?? '')
  // Injected as a plain note — NOT wrapped in === === so Claude does not treat it as an order source
  const coordHint = preCoord.name
    ? `[SYSTEM NOTE — THIS IS NOT AN ORDER AND PRODUCES NO NEW ROWS]\nThe system has already confirmed the coordinator for this batch:\n  coordinator_name = "${preCoord.name}"\n  coordinator_phone = "${preCoord.phone ?? ''}"\nApply these values to every order. Do NOT count this note as an order or site.\n[END NOTE]\n`
    : ''
  console.log(`[claude] pre-extracted coordinator: name="${preCoord.name}" phone="${preCoord.phone}"`)

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
          const userContent = [coordHint, resolvedEmailSection, excelSection].filter(Boolean).join('\n\n')
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
    const rawContent = [coordHint, resolvedEmailSection, excelSection].filter(Boolean).join('\n\n')
    const userContent = await resolveGoogleMapsUrls(rawContent)
    allOrders = await callClaude(userContent, 'single')
  }

  // Post-process: force-apply pre-extracted coordinator to any order Claude left null.
  // This is 100% reliable — no dependence on Claude following prompt instructions.
  if (preCoord.name) {
    let filled = 0
    for (const order of allOrders) {
      if (!order.coordinator_name) {
        order.coordinator_name = preCoord.name
        order.coordinator_phone = preCoord.phone ?? undefined
        filled++
      }
    }
    if (filled > 0) {
      console.log(`[claude] post-process: filled coordinator into ${filled} order(s)`)
    }
  }

  console.log(`[claude] total extracted: ${allOrders.length} order(s)`)
  return { orders: allOrders }
}
