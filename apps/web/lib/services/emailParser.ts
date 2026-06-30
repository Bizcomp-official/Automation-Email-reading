import { simpleParser } from 'mailparser'
import * as XLSX from 'xlsx'

// msgreader handles Outlook's proprietary .msg binary format.
// Loaded dynamically so the server still starts if the package isn't installed yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MsgReader: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('msgreader')
  MsgReader = mod.default ?? mod

  // msgreader v1.x only maps PR_BODY (0x1000, plain text). Patch its const to also
  // extract PR_BODY_HTML (0x1013) so HTML-formatted Outlook emails aren't silently dropped.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const msgConst = require('msgreader/lib/const')
  const nameMapping = msgConst?.default?.MSG?.FIELD?.NAME_MAPPING
  if (nameMapping && !nameMapping['1013']) {
    nameMapping['1013'] = 'bodyHtml'
  }
} catch {
  /* will surface a clear error at upload time */
}

export interface ParsedEmail {
  subject: string
  from: string
  receivedAt: Date | null
  bodyText: string
  // Each Excel row rendered as "Row N: { col: val, col: val, ... }" for clarity
  excelRows: string
  rawExcelRows: Record<string, unknown>[]
}

async function parseMsgBuffer(buffer: Buffer): Promise<ParsedEmail> {
  if (!MsgReader) {
    throw new Error(
      'ไม่พบ package msgreader — กรุณารันคำสั่ง: npm install msgreader --workspace=apps/web แล้ว restart server'
    )
  }

  const reader = new MsgReader(buffer)
  const msg = reader.getFileData()

  // msgreader can return string (unicode) or Uint8Array (binary) depending on MAPI type
  const toStr = (s: unknown): string => {
    if (typeof s === 'string') return s.replace(/\0/g, '').trim()
    if (s instanceof Uint8Array || Buffer.isBuffer(s)) return Buffer.from(s).toString('utf8').replace(/\0/g, '').trim()
    return ''
  }
  const stripHtml = (s: unknown): string =>
    toStr(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const subject: string = toStr(msg.subject)
  const from: string = msg.senderEmail
    ? `${toStr(msg.senderName)} <${toStr(msg.senderEmail)}>`.trim()
    : toStr(msg.senderName)

  // Prefer plain text; fall back to stripped HTML
  const bodyText: string = toStr(msg.body) || stripHtml(msg.bodyHtml)

  console.log('[emailParser/msg] raw fields:', {
    hasBody: !!msg.body, bodyLen: toStr(msg.body).length,
    hasBodyHtml: !!msg.bodyHtml, bodyHtmlLen: toStr(msg.bodyHtml).length,
    bodyTextLen: bodyText.length,
    attachCount: (msg.attachments ?? []).length,
  })

  let excelRows = ''
  let rawExcelRows: Record<string, unknown>[] = []

  for (const att of (msg.attachments ?? []) as Array<{ fileName?: string }>) {
    const name = toStr(att.fileName).toLowerCase()
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
      const attData = reader.getAttachment(att)
      if (attData?.content) {
        try {
          const result = parseExcelBuffer(Buffer.from(attData.content as ArrayBuffer))
          excelRows = result.text
          rawExcelRows = result.rows
          console.log(`[emailParser/msg] attachment: ${name}, rows: ${rawExcelRows.length}`)
          break
        } catch (err) {
          console.warn(`[emailParser/msg] skipping attachment "${name}" — parse failed: ${String(err)}`)
        }
      }
    }
  }

  console.log(`[emailParser/msg] subject="${subject}" from="${from}" bodyLen=${bodyText.length}`)
  return { subject, from, receivedAt: null, bodyText, excelRows, rawExcelRows }
}

export async function parseEmailBuffer(buffer: Buffer, filename?: string): Promise<ParsedEmail> {
  if (filename?.toLowerCase().endsWith('.msg')) {
    return parseMsgBuffer(buffer)
  }

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
