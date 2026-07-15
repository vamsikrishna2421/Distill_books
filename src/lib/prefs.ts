import { createLocalStore, useStore } from './store'

export type AppTheme = 'light' | 'dark'
export type ReaderTheme = 'paper' | 'sepia' | 'dark'

export interface Prefs {
  appTheme: AppTheme
  /** null → follow the app theme until the reader theme is chosen explicitly */
  readerTheme: ReaderTheme | null
  fontScale: number
  wide: boolean
  ttsRate: number
  /** voiceURI of the chosen speech voice; null → best available default */
  ttsVoice: string | null
}

const systemDark =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches

const defaultPrefs: Prefs = {
  appTheme: systemDark ? 'dark' : 'light',
  readerTheme: null,
  fontScale: 1,
  wide: false,
  ttsRate: 1,
  ttsVoice: null,
}

const store = createLocalStore<Prefs>('distill.prefs.v1', defaultPrefs)

export function usePrefs(): Prefs {
  return useStore(store)
}

export function getPrefs(): Prefs {
  return store.get()
}

export function updatePrefs(patch: Partial<Prefs>): void {
  store.set((s) => ({ ...s, ...patch }))
}

export function bumpFontScale(delta: number): void {
  store.set((s) => ({
    ...s,
    fontScale: Math.min(1.3, Math.max(0.85, Math.round((s.fontScale + delta) * 100) / 100)),
  }))
}

export function resolveReaderTheme(prefs: Prefs): ReaderTheme {
  return prefs.readerTheme ?? (prefs.appTheme === 'dark' ? 'dark' : 'paper')
}
