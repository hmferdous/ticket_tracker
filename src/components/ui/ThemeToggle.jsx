import { Sun, Moon, Monitor } from "lucide-react"
import { useTheme } from "../../context/ThemeContext"

const CYCLE = ["light", "dark", "system"]
const ICONS = { light: Sun, dark: Moon, system: Monitor }
const LABELS = { light: "Light", dark: "Dark", system: "System" }

// Compact icon button for the sidebar — cycles Light -> Dark -> System on
// each click. Icon reflects the current selection (not the resolved theme),
// so "System" always shows the monitor icon regardless of which way it
// currently happens to resolve.
export function ThemeToggleCompact({ collapsed }) {
  const { theme, setTheme } = useTheme()
  const Icon = ICONS[theme] ?? Monitor

  const handleClick = () => {
    const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length]
    setTheme(next)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Theme: ${LABELS[theme] ?? "System"} (click to change)`}
      aria-label="Change theme"
      className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
        collapsed ? "justify-center px-2" : "px-3 w-full"
      }`}
    >
      <Icon className="w-5 h-5 shrink-0" />
      {!collapsed && (LABELS[theme] ?? "System")}
    </button>
  )
}

// Full three-way segmented control for the Settings page.
export function ThemeToggleFull() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 p-1 bg-gray-50 dark:bg-gray-800">
      {CYCLE.map((value) => {
        const Icon = ICONS[value]
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            <Icon className="w-4 h-4" />
            {LABELS[value]}
          </button>
        )
      })}
    </div>
  )
}
