'use client'

interface MapPreviewProps {
  lat: number
  lng: number
  zoom?: number
}

export default function MapPreview({ lat, lng, zoom = 16 }: MapPreviewProps) {
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
