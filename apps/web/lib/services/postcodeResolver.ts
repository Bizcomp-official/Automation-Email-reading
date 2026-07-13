// Postcode → Thai district/subdistrict/province lookup table.
// Add entries here as new postcodes are encountered.
// "roman" arrays cover all common romanisations (lowercase, no spaces/dashes).

interface SubdistrictEntry { thai: string; roman: string[] }
interface PostcodeEntry {
  district: string
  province: string
  subdistricts: SubdistrictEntry[]
}

const POSTCODE_MAP: Record<string, PostcodeEntry> = {
  '10120': {
    district: 'สาทร',
    province: 'กรุงเทพมหานคร',
    subdistricts: [
      { thai: 'ทุ่งมหาเมฆ', roman: ['tungmahamek', 'tungmahameg', 'thungmahamek', 'thungmahameg', 'thungmahamet'] },
      { thai: 'ยานนาวา',    roman: ['yanawa', 'yannawa'] },
      { thai: 'ทุ่งวัดดอน', roman: ['thungwatdon', 'tungwatdon'] },
    ],
  },
  '10500': {
    district: 'บางรัก',
    province: 'กรุงเทพมหานคร',
    subdistricts: [
      { thai: 'สีลม',          roman: ['silom'] },
      { thai: 'สุริยวงศ์',      roman: ['suriyawong', 'suriwong'] },
      { thai: 'บางรัก',        roman: ['bangrak', 'bangrak'] },
      { thai: 'มหาพฤฒาราม',   roman: ['mahaphruttharam', 'mahahphruttharam'] },
      { thai: 'สี่พระยา',      roman: ['siphraya', 'siphaya'] },
    ],
  },
}

export function hasPostcode(postcode: string): boolean {
  return postcode.trim() in POSTCODE_MAP
}

export interface ResolveResult {
  value: string
  status: 'correct' | 'suspicious'
  ai_note: string
}

// Lowercase + strip spaces, dashes, dots, apostrophes for comparison
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-\.']/g, '')
}

// Keep only Thai script (U+0E00–U+0E7F), ASCII letters/digits, and spaces.
// Removes stray Devanagari, CJK, or other garbage a model might hallucinate.
function stripGarbage(s: string): string {
  return s.replace(/[^฀-๿a-zA-Z0-9\s]/gu, '').trim()
}

export function resolveSubdistrict(raw: string, postcode: string): ResolveResult {
  const cleaned = stripGarbage(raw.trim())
  const entry = POSTCODE_MAP[postcode.trim()]

  if (!entry) {
    return { value: cleaned, status: 'suspicious', ai_note: `ไม่มีตารางสำหรับ ${postcode} – กรุณาตรวจสอบ` }
  }

  // 1. Exact Thai match
  const exactMatch = entry.subdistricts.find(s => s.thai === cleaned)
  if (exactMatch) return { value: exactMatch.thai, status: 'correct', ai_note: '' }

  // 2. Romanised alias match
  const n = norm(cleaned)
  const romanMatch = entry.subdistricts.find(s => s.roman.some(r => norm(r) === n))
  if (romanMatch) {
    return {
      value: romanMatch.thai,
      status: 'correct',
      ai_note: `แก้จาก "${raw.trim()}" → "${romanMatch.thai}"`,
    }
  }

  // 3. No confident match — keep cleaned value, flag for human review
  return { value: cleaned, status: 'suspicious', ai_note: 'ไม่พบในตาราง – กรุณาตรวจสอบ' }
}

export function resolveDistrict(raw: string, postcode: string): ResolveResult {
  const cleaned = stripGarbage(raw.trim())
  const entry = POSTCODE_MAP[postcode.trim()]

  if (!entry) {
    return { value: cleaned, status: 'suspicious', ai_note: `ไม่มีตารางสำหรับ ${postcode} – กรุณาตรวจสอบ` }
  }

  // District is unambiguous per postcode — always use the table value
  if (cleaned === entry.district) return { value: cleaned, status: 'correct', ai_note: '' }
  return {
    value: entry.district,
    status: 'correct',
    ai_note: `แก้จาก "${raw.trim()}" → "${entry.district}"`,
  }
}

export function resolveProvince(raw: string, postcode: string): ResolveResult {
  const cleaned = stripGarbage(raw.trim())
  const entry = POSTCODE_MAP[postcode.trim()]

  if (!entry) {
    return { value: cleaned, status: 'suspicious', ai_note: `ไม่มีตารางสำหรับ ${postcode} – กรุณาตรวจสอบ` }
  }

  // Province is unambiguous per postcode — always use the table value
  if (cleaned === entry.province) return { value: cleaned, status: 'correct', ai_note: '' }
  return {
    value: entry.province,
    status: 'correct',
    ai_note: `แก้จาก "${raw.trim()}" → "${entry.province}"`,
  }
}
