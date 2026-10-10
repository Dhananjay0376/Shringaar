import { describe, expect, it } from 'vitest'

import {
  add,
  angleBetween,
  clamp,
  clamp01,
  distance,
  length,
  mean,
  midpoint,
  normalise,
  scaleBy,
  sub,
  vec2,
} from '../core/geometry'

describe('normalise', () => {
  /* The load-bearing case. Every direction the solver computes passes through here, and a zero
     vector arrives whenever a landmark repeats — which happens on a degenerate contour. Returning
     NaN would propagate silently into the canvas transform; returning zero lets the caller's own
     guard decide. */
  it('returns the zero vector for a zero vector rather than NaN', () => {
    const result = normalise(vec2(0, 0))
    expect(result).toEqual({ x: 0, y: 0 })
    expect(Number.isNaN(result.x)).toBe(false)
    expect(Number.isNaN(result.y)).toBe(false)
  })

  it('returns the zero vector for a vector below the epsilon floor', () => {
    expect(normalise(vec2(1e-12, 1e-12))).toEqual({ x: 0, y: 0 })
  })

  it('produces a unit vector', () => {
    const unit = normalise(vec2(3, 4))
    expect(unit.x).toBeCloseTo(0.6, 12)
    expect(unit.y).toBeCloseTo(0.8, 12)
    expect(length(unit)).toBeCloseTo(1, 12)
  })

  it('preserves direction', () => {
    const source = vec2(-7, 2.5)
    const unit = normalise(source)
    expect(unit.x).toBeLessThan(0)
    expect(unit.y).toBeGreaterThan(0)
  })
})

describe('midpoint and distance', () => {
  it('agree with hand-computed values', () => {
    const a = vec2(0, 0)
    const b = vec2(6, 8)
    expect(midpoint(a, b)).toEqual({ x: 3, y: 4 })
    expect(distance(a, b)).toBeCloseTo(10, 12)
  })

  it('midpoint is exact at the endpoints', () => {
    expect(midpoint(vec2(2, 5), vec2(2, 5))).toEqual({ x: 2, y: 5 })
  })

  /* `a + (b - a)/2` and `(a + b)/2` differ in precision near the top of the double range. This pins
     the interpolated form so a later "simplification" back to the sum is caught. */
  it('stays finite for very large coordinates where the sum would overflow', () => {
    const big = vec2(1e308, 1e308)
    const result = midpoint(big, big)
    expect(Number.isFinite(result.x)).toBe(true)
    expect(Number.isFinite(result.y)).toBe(true)
    expect(result).toEqual({ x: 1e308, y: 1e308 })
  })
})

describe('add, sub and scaleBy', () => {
  it('compose as expected', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 })
    expect(sub(vec2(3, 4), vec2(1, 2))).toEqual({ x: 2, y: 2 })
    expect(scaleBy(vec2(2, -3), 2.5)).toEqual({ x: 5, y: -7.5 })
  })

  it('sub is the inverse of add', () => {
    const a = vec2(-4.5, 11)
    const b = vec2(2, 3)
    expect(add(sub(a, b), b)).toEqual(a)
  })
})

describe('mean', () => {
  it('averages a point set', () => {
    expect(mean([vec2(0, 0), vec2(4, 0), vec2(2, 6)])).toEqual({ x: 2, y: 2 })
  })

  /* An empty cluster is reachable if a future guard lets one through. NaN here would be worse than
     a wrong answer, because NaN compares false against everything and so passes every downstream
     range check while breaking the render. */
  it('returns the origin for an empty set rather than NaN', () => {
    expect(mean([])).toEqual({ x: 0, y: 0 })
  })

  it('is independent of the number of duplicates', () => {
    expect(mean([vec2(5, 5), vec2(5, 5), vec2(5, 5)])).toEqual({ x: 5, y: 5 })
  })
})

describe('clamp', () => {
  it('bounds on both sides and passes through in range', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(4, 0, 10)).toBe(4)
  })

  it('clamp01 is clamp against the unit interval', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(0.3)).toBe(0.3)
  })
})

describe('angleBetween', () => {
  it('is signed, not absolute', () => {
    /* The whole reason this is not `acos(dot)`: a head rolled 10° each way must give two different
       numbers, or the earrings counter-rotate to the wrong side of the tilt. */
    const origin = vec2(0, 0)
    const up = angleBetween(origin, vec2(0, -1))
    const tiltedOneWay = angleBetween(origin, vec2(1, -1))
    const tiltedOtherWay = angleBetween(origin, vec2(-1, -1))

    expect(tiltedOneWay).toBeGreaterThan(up)
    expect(tiltedOtherWay).toBeLessThan(up)
    expect(tiltedOneWay).not.toBeCloseTo(tiltedOtherWay, 3)
  })

  it('reads a horizontal left-to-right pair as approximately zero roll', () => {
    expect(angleBetween(vec2(10, 20), vec2(30, 20))).toBeCloseTo(0, 12)
  })

  it('reads a downward-sloping pair as a positive angle, since screen y points down', () => {
    expect(angleBetween(vec2(0, 0), vec2(1, 1))).toBeCloseTo(Math.PI / 4, 12)
  })
})
