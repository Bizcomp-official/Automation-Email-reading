import { simpleParser } from 'mailparser'
import * as XLSX from 'xlsx'

// Decode RTF to plain text.
// Handles \uN? unicode escapes and \'XX Windows-874 (Thai) hex escapes.
// Thai characters in Windows-874 map to Unicode via offset +0xD60 for ranges 0xA1-0xDA and 0xE0-0xFB.
function stripRtf(rtf: string): string {
  // Unicode escape: \u<signed-int>? → char
  let text = rtf.replace(/\\u(-?\d+)\??/g, (_, n) => {
    const cp = parseInt(n, 10)
    const codePoint = cp < 0 ? cp + 65536 : cp
    return codePoint > 31 ? String.fromCodePoint(codePoint) : ' '
  })
  // Windows-874 hex escape: \'XX
  text = text.replace(/\\'([0-9a-f]{2})/gi, (_, hex) => {
    const b = parseInt(hex, 16)
    if ((b >= 0xa1 && b <= 0xda) || (b >= 0xe0 && b <= 0xfb)) return String.fromCodePoint(b + 0xd60)
    if (b >= 0x20 && b < 0x7f) return String.fromCodePoint(b)
    return ''
  })
  // Strip RTF control words, groups, and backslash commands
  return text
    .replace(/\{[^{}]*\}/g, '')
    .replace(/\\[a-z]+\*?-?\d* ?/gi, ' ')
    .replace(/[{}\\]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]*>?/g, ' ')   // >? handles truncated/unclosed tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// msgreader handles Outlook's proprietary .msg binary format.
// Loaded dynamically so the server still starts if the package isn't installed yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MsgReader: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('msgreader')
  MsgReader = mod.default ?? mod

  // msgreader v1.x only maps PR_BODY (0x1000, plain text). Patch its const to also
  // extract PR_BODY_HTML (0x1013) and PR_RTF_COMPRESSED (0x1009) so rich-text and
  // HTML-formatted Outlook emails aren't silently dropped.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const msgConst = require('msgreader/lib/const')
  const nameMapping = msgConst?.default?.MSG?.FIELD?.NAME_MAPPING
  if (nameMapping) {
    if (!nameMapping['1013']) nameMapping['1013'] = 'bodyHtml'
    if (!nameMapping['1009']) nameMapping['1009'] = 'bodyRtf'
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

  const subject: string = toStr(msg.subject)
  const from: string = msg.senderEmail
    ? `${toStr(msg.senderName)} <${toStr(msg.senderEmail)}>`.trim()
    : toStr(msg.senderName)

  // Priority: plain text → HTML → RTF (Outlook's native format, stored as PR_RTF_COMPRESSED 0x1009)
  const plainText  = toStr(msg.body)
  const htmlText   = htmlToText(toStr(msg.bodyHtml))
  const rtfRaw     = toStr(msg.bodyRtf)
  // rtfRaw may be binary compressed (LZFu); only use it if it looks like readable RTF text
  const rtfText    = rtfRaw.startsWith('{\\rtf') ? stripRtf(rtfRaw) : ''
  const bodyText: string = plainText || htmlText || rtfText

  console.log('[emailParser/msg] raw fields:', {
    hasBody: !!msg.body, bodyLen: plainText.length,
    hasBodyHtml: !!msg.bodyHtml, bodyHtmlLen: toStr(msg.bodyHtml).length,
    hasBodyRtf: !!msg.bodyRtf, bodyRtfLen: rtfRaw.length, rtfReadable: rtfRaw.startsWith('{\\rtf'),
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
  const rawText = parsed.text ?? ''
  // If the text part is absent or is raw HTML (starts with <!DOCTYPE / <html / <meta),
  // strip the HTML body instead so Claude receives readable text.
  const looksLikeHtml = /^\s*(?:<[!?]|<html|<meta)/i.test(rawText)
  const bodyText = (rawText && !looksLikeHtml) ? rawText : htmlToText(parsed.html || '')

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
