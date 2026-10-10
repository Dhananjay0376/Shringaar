/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  DEMO DATA GENERATOR — these are not the seller's real numbers.                          ║
 * ║                                                                                          ║
 * ║  The series is synthetic but deterministic: the same date always yields the same values,  ║
 * ║  so the dashboard does not reshuffle on every render. Every consumer labels it as demo.   ║
 * ║                                                                                          ║
 * ║  Real numbers come from the append-only `analytics_events` table (arch.md §7.5), never   ║
 * ║  from this file.                                                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 */

import type {
  AnalyticsPoint,
  AnalyticsRange,
  AnalyticsSummary,
  AnalyticsTopProduct,
  AnalyticsTotals,
  Product,
} from '../types/seller'
import { hasUsableTryOnAsset } from '../utils/product'

/** Small deterministic PRNG (mulberry32) — no dependency, stable across runs. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a, used to turn a date string into a stable seed. */
function hashString(input: string): number {
  let hash = 2166136261

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function shiftDays(base: Date, days: number): Date {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  date.setHours(12, 0, 0, 0)
  return date
}

interface DayCounts extends AnalyticsTotals {
  date: string
}

/**
 * One day of plausible traffic. Weekends run hotter (jewellery browsing peaks at the weekend) and
 * there is a mild upward trend so the chart has a direction rather than looking like noise.
 */
function generateDay(date: Date, offsetFromToday: number, range: number): DayCounts {
  const random = mulberry32(hashString(`${dayKey(date)}|shringaar-demo`))
  const weekday = date.getDay()
  const isWeekend = weekday === 0 || weekday === 6

  const seasonality = isWeekend ? 1.28 : 1
  const trend = 1 + 0.18 * (1 - offsetFromToday / Math.max(range, 1))

  const storeVisits = Math.round(68 * seasonality * trend * (0.78 + 0.44 * random()))
  const productViews = Math.round(storeVisits * (1.55 + 0.6 * random()))
  const tryOnStarts = Math.round(productViews * (0.13 + 0.07 * random()))
  const outboundClicks = Math.round(productViews * (0.045 + 0.035 * random()))
  const contactClicks = Math.round(storeVisits * (0.025 + 0.025 * random()))

  return {
    date: date.toISOString(),
    storeVisits,
    productViews,
    tryOnStarts,
    outboundClicks,
    contactClicks,
  }
}

function sumTotals(points: DayCounts[]): AnalyticsTotals {
  return points.reduce<AnalyticsTotals>(
    (totals, point) => ({
      storeVisits: totals.storeVisits + point.storeVisits,
      productViews: totals.productViews + point.productViews,
      tryOnStarts: totals.tryOnStarts + point.tryOnStarts,
      outboundClicks: totals.outboundClicks + point.outboundClicks,
      contactClicks: totals.contactClicks + point.contactClicks,
    }),
    { storeVisits: 0, productViews: 0, tryOnStarts: 0, outboundClicks: 0, contactClicks: 0 },
  )
}

function buildSeries(range: AnalyticsRange, now: Date): DayCounts[] {
  const points: DayCounts[] = []

  for (let offset = range - 1; offset >= 0; offset -= 1) {
    points.push(generateDay(shiftDays(now, -offset), offset, range))
  }

  return points
}

function buildPreviousSeries(range: AnalyticsRange, now: Date): DayCounts[] {
  const points: DayCounts[] = []

  for (let offset = range * 2 - 1; offset >= range; offset -= 1) {
    points.push(generateDay(shiftDays(now, -offset), offset, range))
  }

  return points
}

/**
 * Per-product breakdown. Views are weighted by how long the product has been live and whether it
 * has a usable try-on asset, and scaled so the column sums to the period's product views.
 */
function buildTopProducts(
  products: Product[],
  totalViews: number,
  totalTryOn: number,
  totalOutbound: number,
  now: Date,
): AnalyticsTopProduct[] {
  if (products.length === 0) return []

  const weights = products.map((product) => {
    const ageDays = Math.max(
      1,
      (now.getTime() - new Date(product.createdAt).getTime()) / 86_400_000,
    )
    const tryOnBoost = hasUsableTryOnAsset(product) ? 1.45 : 1
    const publishedBoost = product.status === 'published' ? 1.6 : 0.35
    const jitter = 0.8 + 0.4 * mulberry32(hashString(product.id))()

    return Math.log2(ageDays + 2) * tryOnBoost * publishedBoost * jitter
  })

  const weightSum = weights.reduce((total, weight) => total + weight, 0) || 1

  return products
    .map((product, index) => {
      const share = (weights[index] ?? 0) / weightSum

      return {
        productId: product.id,
        name: product.name,
        views: Math.round(totalViews * share),
        tryOnStarts: Math.round(totalTryOn * share),
        outboundClicks: Math.round(totalOutbound * share),
      }
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 6)
}

export function buildDemoAnalytics(
  range: AnalyticsRange,
  products: Product[],
  now: Date = new Date(),
): AnalyticsSummary {
  const series: AnalyticsPoint[] = buildSeries(range, now)
  const totals = sumTotals(series)
  const previousTotals = sumTotals(buildPreviousSeries(range, now))

  return {
    range,
    dataSource: 'demo',
    generatedAt: now.toISOString(),
    totals,
    previousTotals,
    series,
    topProducts: buildTopProducts(
      products,
      totals.productViews,
      totals.tryOnStarts,
      totals.outboundClicks,
      now,
    ),
  }
}

/** Percentage change between two periods, or null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}
