import { useEffect, type ReactNode } from 'react'
import { applyTheme, useTheme } from './theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { preference, resolved } = useTheme()
  useEffect(() => {
    // Read the actual browser preference even during static-page hydration.
    applyTheme()
  }, [preference, resolved])
  return children
}
