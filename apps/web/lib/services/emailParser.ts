import { simpleParser } from 'mailparser'
import * as XLSX from 'xlsx'

export interface ParsedEmail {
  subject: string
  from: string
  receivedAt: Date | null
  bodyText: string
  // Each Excel row rendered as "Row N: { col: val, col: val, ... }" for clarity
  excelRows: string
  rawExcelRows: Record<string, unknown>[]
}

export async function parseEmailBuffer(buffer: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(buffer)

  const subject = parsed.subject ?? ''
  const from = parsed.from?.text ?? ''
  const receivedAt = parsed.date ?? null
  const bodyText = parsed.text ?? ''

  let excelRows = ''
  let rawExcelRows: Record<string, unknown>[] = []

  for (const attachment of parsed.attachments ?? []) {
    const name = attachment.filename?.toLowerCase() ?? ''
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
      const result = parseExcelBuffer(attachment.content)
      excelRows = result.text
      rawExcelRows = result.rows
      console.log(`[emailParser] found attachment: ${attachment.filename}, rows: ${rawExcelRows.length}`)
      break
    }
  }

  return { subject, from, receivedAt, bodyText, excelRows, rawExcelRows }
}

export function parseExcelBuffer(buffer: Buffer): { text: string; rows: Record<string, unknown>[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { text: '', rows: [] }

  const sheet = workbook.Sheets[sheetName]

  // Include raw text cells (dates, merged cells etc.) with raw:false so values are strings
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  })

  if (rows.length === 0) return { text: '', rows: [] }

  // Render as labeled rows so Claude sees "column_name: value" pairs clearly
  const text = rows
    .map((row, i) => {
      const pairs = Object.entries(row)
        .filter(([, v]) => v !== null && v !== '' && v !== undefined)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
      return `--- Row ${i + 1} ---\n${pairs}`
    })
    .join('\n\n')

  return { text, rows }
}
