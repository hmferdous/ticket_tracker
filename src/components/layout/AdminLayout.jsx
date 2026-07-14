import { NavLink, useNavigate } from "react-router-dom"
import { Users, Settings as SettingsIcon } from "lucide-react"
import { useAuth } from "../../context/AuthContext"
import { ThemeToggleCompact } from "../ui/ThemeToggle"

const NAV_LINKS = [
  { to: "/admin/agents", label: "Agents", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
]

export default function AdminLayout({ title, actions, children }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <aside className="fixed inset-y-0 left-0 w-60 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="px-6 py-5">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">Ticket Tracker</span>
          <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">Admin</span>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV_LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border-l-4 transition-colors ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400"
                    : "text-gray-600 dark:text-gray-400 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800"
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="py-2 px-3 border-t border-gray-100 dark:border-gray-800">
          <ThemeToggleCompact collapsed={false} />
        </div>

        <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate mb-2">{user?.email}</p>
          <button
            onClick={handleLogout}
            className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium transition-colors"
          >
            Logout
          </button>
        </div>
      </aside>

      <div className="ml-60 min-h-screen flex flex-col">
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
