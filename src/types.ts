export interface Category {
  id: string
  name: string
  description: string
  order: number
}

export interface MapChapter {
  number: number
  title: string
  minutes: number
  summary: string
  readIf: string[]
}

export interface BookMapData {
  intro: string
  howToUse?: string
  chapters: MapChapter[]
}

export interface Book {
  id: string
  title: string
  subtitle?: string
  author: string
  year: number
  originalPages: number
  categoryId: string
  difficulty: 1 | 2 | 3
  syllabusOrder: number
  accent: string
  tagline: string
  whyRead: string
  map: BookMapData
}

export interface Chapter {
  number: number
  title: string
  words: number
  minutes: number
  keyIdeas: string[]
  bodyHtml: string
  inPractice: string[]
}

export interface BookStats {
  mapMinutes: number
  deepMinutes: number
  totalMinutes: number
  distilledPages: number
  originalMinutes: number
  savedPct: number
}
