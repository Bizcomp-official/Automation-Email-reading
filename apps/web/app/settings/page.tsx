import DashboardLayout from '../components/DashboardLayout'

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="p-8 max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">การตั้งค่าระบบ</p>
        </div>

        <div className="space-y-4">
          {/* Claude AI connection */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 2a8 8 0 100 16A8 8 0 0012 4zm0 3a5 5 0 110 10A5 5 0 0112 7zm0 2a3 3 0 100 6 3 3 0 000-6z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">Claude AI (Anthropic)</div>
                <div className="text-xs text-gray-500">claude-sonnet-4-6 · Model API</div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          </div>

          {/* Supabase connection */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">Supabase Database</div>
                <div className="text-xs text-gray-500">Postgres · Service Role</div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          </div>

          {/* RPA ingest — NOT configured */}
          <div className="bg-white rounded-xl border border-gray-200 border-dashed p-5 flex items-center justify-between opacity-70">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700">API for RPA</div>
                <div className="text-xs text-gray-400">POST /api/ingest · ยังไม่ได้ตั้งค่า — รอสเปค RPA</div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
              Not configured
            </span>
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          กำหนดค่า API Keys ใน <code className="bg-gray-100 px-1 rounded">apps/api/.env</code>
        </p>
      </div>
    </DashboardLayout>
  )
}
