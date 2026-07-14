import { createContext, useContext, useEffect, useState } from "react"

const ThemeContext = createContext({})

const STORAGE_KEY = "theme"

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

// "system" resolves against the OS preference; light/dark are explicit
// overrides. This mirrors the inline script in index.html that runs before
// React mounts, so the two never disagree.
function resolve(theme) {
  return theme === "dark" || (theme === "system" && systemPrefersDark()) ? "dark" : "light"
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => localStorage.getItem(STORAGE_KEY) || "system")
  const [resolvedTheme, setResolvedTheme] = useState(() => resolve(theme))

  useEffect(() => {
    const applied = resolve(theme)
    setResolvedTheme(applied)
    document.documentElement.classList.toggle("dark", applied === "dark")
  }, [theme])

  // Only relevant while following the OS preference — live-updates if the
  // user changes their system theme without touching the in-app toggle.
  useEffect(() => {
    if (theme !== "system") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      const applied = resolve("system")
      setResolvedTheme(applied)
      document.documentElement.classList.toggle("dark", applied === "dark")
    }
    mql.addEventListener("change", handleChange)
    return () => mql.removeEventListener("change", handleChange)
  }, [theme])

  const setTheme = (next) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
