import { useState } from "react"
import Sidebar from "./Sidebar"

const STORAGE_KEY = "sidebar_collapsed"

export default function AppLayout({ title, actions, children }) {
  // Read once per mount rather than in an effect — AppLayout remounts on
  // every page navigation (each page renders its own <AppLayout>), so this
  // needs to reflect the stored preference immediately, not flash open
  // before an effect catches up.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "true")

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div className={`${collapsed ? "ml-16" : "ml-60"} min-h-screen flex flex-col transition-[margin] duration-200`}>
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
