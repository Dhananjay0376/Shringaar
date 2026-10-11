/**
 * useTinyFishDescription
 *
 * Generates a short jewellery product description using Google Gemini
 * (via the @google/genai SDK already in this project).
 *
 * The hook is deliberately thin: it holds loading + error state and exposes
 * a single `generate` function. The caller owns the description string so it
 * can be edited freely after generation.
 *
 * API key: set VITE_GEMINI_API_KEY in .env.local (never commit it).
 * Falls back to a hardcoded key for local dev if the env var is absent.
 */

import { useState } from 'react'
import { GoogleGenAI } from '@google/genai'

const API_KEY =
  (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? ''

export function useTinyFishDescription() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate(productName: string, category: string): Promise<string | null> {
    if (!productName.trim()) return null
    if (!API_KEY) {
      setError('VITE_GEMINI_API_KEY is not set.')
      return null
    }

    setLoading(true)
    setError(null)

    const prompt = `Write a short, engaging product description (2–3 sentences) for a jewellery item called "${productName}" in the category "${category}". Focus on material, design appeal, and who it suits. Keep it warm, concise, and suitable for an Indian jewellery storefront. Return only the description, no extra text.`

    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY })
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
      })

      const text = response.text?.trim() ?? null
      return text || null
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not generate description.'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }

  return { generate, loading, error }
}
