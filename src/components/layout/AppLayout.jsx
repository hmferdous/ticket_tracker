import Sidebar from "./Sidebar"

export default function AppLayout({ title, actions, children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="ml-60 min-h-screen flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
