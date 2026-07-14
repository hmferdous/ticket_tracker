import { useState } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { LayoutDashboard, Ticket, Users, Building2, CreditCard, Settings, FileText, ChevronDown, ChevronRight, ChevronLeft, LogOut } from "lucide-react"
import { useAuth } from "../../context/AuthContext"

const NAV_LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tickets", label: "Tickets", icon: Ticket },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/suppliers", label: "Suppliers", icon: Building2 },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/settings", label: "Settings", icon: Settings },
]

const REPORT_LINKS = [
  { to: "/reports/client-ledger", label: "Client Ledger" },
  { to: "/reports/supplier-ledger", label: "Supplier Ledger" },
  { to: "/reports/channel-ledger", label: "Channel Ledger" },
]

export default function Sidebar({ collapsed = false, onToggleCollapsed }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const reportsActive = location.pathname.startsWith("/reports")
  const [reportsOpen, setReportsOpen] = useState(reportsActive)

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  // Collapsed rail has no room for the submenu — expand first, then open it,
  // rather than trying to fit a flyout in a 64px-wide strip.
  const handleReportsClick = () => {
    if (collapsed) {
      onToggleCollapsed?.()
      setReportsOpen(true)
    } else {
      setReportsOpen((o) => !o)
    }
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 ${collapsed ? "w-16" : "w-60"} bg-white border-r border-gray-200 flex flex-col transition-[width] duration-200`}
    >
      <div className={`flex items-center py-5 ${collapsed ? "justify-center px-2" : "justify-between px-6"}`}>
        {!collapsed && <span className="text-lg font-semibold text-gray-900 truncate">Ticket Tracker</span>}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto overflow-x-hidden">
        {NAV_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium border-l-4 transition-colors ${
                collapsed ? "justify-center px-2" : "px-3"
              } ${
                isActive
                  ? "bg-blue-50 text-blue-600 border-blue-600"
                  : "text-gray-600 border-transparent hover:bg-gray-50"
              }`
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            {!collapsed && label}
          </NavLink>
        ))}

        {/* Reports group */}
        <div>
          <button
            type="button"
            onClick={handleReportsClick}
            title={collapsed ? "Reports" : undefined}
            className={`w-full flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium border-l-4 transition-colors ${
              collapsed ? "justify-center px-2" : "px-3"
            } ${
              reportsActive
                ? "bg-blue-50 text-blue-600 border-blue-600"
                : "text-gray-600 border-transparent hover:bg-gray-50"
            }`}
          >
            <FileText className="w-5 h-5 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Reports</span>
                {reportsOpen
                  ? <ChevronDown className="w-4 h-4 text-gray-400" />
                  : <ChevronRight className="w-4 h-4 text-gray-400" />
                }
              </>
            )}
          </button>

          {!collapsed && reportsOpen && (
            <div className="mt-1 ml-8 space-y-0.5">
              {REPORT_LINKS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `block px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? "bg-blue-50 text-blue-600 font-medium"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className={`py-4 border-t border-gray-100 ${collapsed ? "flex flex-col items-center px-2" : "px-4"}`}>
        {!collapsed && <p className="text-xs text-gray-400 truncate mb-2">{user?.email}</p>}
        <button
          onClick={handleLogout}
          title={collapsed ? "Logout" : undefined}
          aria-label="Logout"
          className={`text-sm text-red-600 hover:text-red-700 font-medium transition-colors ${collapsed ? "p-1.5 rounded-md hover:bg-red-50" : ""}`}
        >
          {collapsed ? <LogOut className="w-5 h-5" /> : "Logout"}
        </button>
      </div>
    </aside>
  )
}
