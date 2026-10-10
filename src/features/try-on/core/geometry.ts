/**
 * Vector helpers for the try-on core.
 *
 * Plain objects rather than a class, so every value here is comparable with `toEqual` and safe to
 * hold across frames. The set is deliberately small: it contains what the anchor solver and the
 * coordinate transform actually call, and nothing added "in case" — an unused export does not fail
 * `noUnusedLocals`, so speculative helpers survive review unnoticed and quietly accumulate.
 */

export interface Vec2 {
  readonly x: number
  readonly y: number
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

/** Scales a vector. Named `scaleBy` rather than an overloaded `mul` so call sites read as arithmetic. */
export function scaleBy(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k }
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  /* Written as `a + (b - a)/2` rather than `(a + b)/2`. For coordinates near the top of the double
     range the sum can lose precision; the interpolated form cannot. */
  return { x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2 }
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Unit vector, or the zero vector when there is no direction to give. Never NaN. */
export function normalise(a: Vec2): Vec2 {
  const len = length(a)
  /* The epsilon guard matters more than it looks. Two landmarks in the same place — a degenerate
     contour, or one index repeated in a cluster — would otherwise divide by zero and send `NaN` into
     the renderer, where it silently poisons the whole transform instead of throwing. Zero is a wrong
     direction; NaN is no direction at all, and a caller can see the difference. */
  if (len < 1e-9) return { x: 0, y: 0 }
  return { x: a.x / len, y: a.y / len }
}

/** Average of a set of points. Returns the origin for an empty set rather than NaN. */
export function mean(points: readonly Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / points.length, y: y / points.length }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

/**
 * Angle in radians of the vector from `a` to `b`, in screen space where y points down.
 *
 * Used for head roll, where the answer must be *signed and continuous* rather than the unsigned
 * `acos(dot)` of the direction — a head tilted 5° one way and 5° the other must not produce the same
 * number, or the earrings counter-rotate to the wrong side.
 */
export function angleBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}
