import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { usePrefs } from './lib/prefs'
import Library from './pages/Library'
import BookMap from './pages/BookMap'
import Reader from './pages/Reader'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  const prefs = usePrefs()

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.appTheme
  }, [prefs.appTheme])

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/book/:bookId" element={<BookMap />} />
        <Route path="/book/:bookId/read/:num" element={<Reader />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
