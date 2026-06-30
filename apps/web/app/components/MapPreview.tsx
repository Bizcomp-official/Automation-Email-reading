'use client'

interface MapPreviewProps {
  lat?: number | string | null
  lng?: number | string | null
  zoom?: number
  /** 'office' = known location, no GPS needed | 'missing' = needs AE | undefined = auto-detect from lat/lng */
  noCoordReason?: 'office' | 'missing'
}

export default function MapPreview({ lat, lng, zoom = 16, noCoordReason }: MapPreviewProps) {
  if (!lat || !lng) {
    if (noCoordReason === 'office') {
      return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 h-64 flex flex-col items-center justify-center gap-2">
          <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
          <p className="text-sm font-medium text-gray-500">สำนักงาน – ทราบตำแหน่งแล้ว</p>
          <p className="text-xs text-gray-400">ไม่ต้องการพิกัด GPS</p>
        </div>
      )
    }
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 h-64 flex flex-col items-center justify-center gap-2">
        <svg className="w-8 h-8 text-rose-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        <p className="text-sm font-medium text-rose-700">ไม่มีพิกัด GPS</p>
        <p className="text-xs text-rose-500">รอ AE ส่งพิกัดสถานที่ติดตั้ง</p>
      </div>
    )
  }

  const embedSrc = `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        <iframe
          src={embedSrc}
          width="100%"
          height="260"
          className="block"
          loading="lazy"
          title="Google Maps Preview"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <a
        href={mapsLink}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#185FA5] hover:underline"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
        </svg>
        เปิดตำแหน่งจริงใน Google Maps
      </a>
    </div>
  )
}
