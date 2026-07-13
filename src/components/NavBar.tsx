import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { updatePrefs, usePrefs } from '../lib/prefs'

export function NavBar({ children }: { children?: ReactNode }) {
  const prefs = usePrefs()
  const dark = prefs.appTheme === 'dark'
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <span className="nav-mark">◆</span> Distill
        </Link>
        <div className="nav-slot">{children}</div>
        <button
          className="nav-theme"
          onClick={() => updatePrefs({ appTheme: dark ? 'light' : 'dark' })}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={dark ? 'Light theme' : 'Dark theme'}
        >
          {dark ? '☀' : '☾'}
        </button>
      </div>
    </nav>
  )
}
