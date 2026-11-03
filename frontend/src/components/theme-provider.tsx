import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'
const validTheme = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system'
const ThemeContext = createContext<{
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
} | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('theme')
      if (validTheme(saved)) return saved
    } catch { /* Storage can be unavailable in private sessions. */ }
    return 'dark'
  })
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
    document.documentElement.style.colorScheme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
      resolvedTheme === 'light' ? '#f2f4f5' : '#242d35')
  }, [resolvedTheme])

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const systemChanged = () => setSystemDark(query.matches)
    const storageChanged = (event: StorageEvent) => {
      if (event.key === 'theme') updateTheme(validTheme(event.newValue) ? event.newValue : 'dark')
    }
    query.addEventListener('change', systemChanged)
    window.addEventListener('storage', storageChanged)
    return () => {
      query.removeEventListener('change', systemChanged)
      window.removeEventListener('storage', storageChanged)
    }
  }, [])

  return <ThemeContext value={{ resolvedTheme, setTheme: (next) => {
    updateTheme(next)
    try { localStorage.setItem('theme', next) } catch { /* Apply without persistence. */ }
  } }}>{children}</ThemeContext>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme requires ThemeProvider')
  return context
}
