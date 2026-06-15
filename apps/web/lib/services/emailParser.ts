import { simpleParser } from 'mailparser'
import * as XLSX from 'xlsx'

export interface ParsedEmail {
  subject: string
  from: string
  receivedAt: Date | null
  bodyText: string
  excelTable: string
}

export async function parseEmailBuffer(buffer: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(buffer)

  const subject = parsed.subject ?? ''
  const from = parsed.from?.text ?? ''
  const receivedAt = parsed.date ?? null
  const bodyText = parsed.text ?? ''

  let excelTable = ''
  for (const attachment of parsed.attachments ?? []) {
    const name = attachment.filename?.toLowerCase() ?? ''
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
      excelTable = parseExcelBuffer(attachment.content)
      break
    }
  }

  return { subject, from, receivedAt, bodyText, excelTable }
}

export function parseExcelBuffer(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return ''

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (rows.length === 0) return ''

  const headers = Object.keys(rows[0])
  const lines = [
    headers.join('\t'),
    ...rows.map((row) => headers.map((h) => String(row[h] ?? '')).join('\t')),
  ]
  return lines.join('\n')
}
