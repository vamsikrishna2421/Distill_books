import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(next: T | ((current: T) => T)): void
  subscribe(listener: () => void): () => void
}

export function createLocalStore<T extends object>(key: string, fallback: T): Store<T> {
  let state: T
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    state = raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    state = fallback
  }

  const listeners = new Set<() => void>()

  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? (next as (c: T) => T)(state) : next
      try {
        localStorage.setItem(key, JSON.stringify(state))
      } catch {
        // storage unavailable (private mode etc.) — keep in-memory state
      }
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
