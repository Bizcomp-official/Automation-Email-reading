import type { Metadata } from 'next'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import './globals.css'

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  variable: '--font-ibm-plex-sans-thai',
})

export const metadata: Metadata = {
  title: 'FC Address Intelligence — True IS',
  description: 'ระบบตรวจสอบที่อยู่ติดตั้งสำหรับ FC E-Ordering',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${ibmPlexSansThai.variable} h-full`}>
      <body className="h-full font-[family-name:var(--font-ibm-plex-sans-thai)]">{children}</body>
    </html>
  )
}
