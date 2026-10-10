import { describe, expect, it } from 'vitest'

import {
  IMPLEMENTED_AR_CATEGORIES,
  UNSUPPORTED_CATEGORY_REASON,
  chooseRenderer,
  isImplemented,
} from '../renderers/select'
import { implementedCategories } from '../anchors/registry'
import { arAssetFor, type ArAsset, type AssetValidation } from '../types/asset'
import {
  CATEGORIES,
  TRYON_READY_CATEGORIES,
  hasTryOnExperience,
  type CategoryKey,
  type TryOnAnchor,
  type TryOnAssetKind,
} from '@/lib/catalog'

function asset(
  kind: TryOnAssetKind,
  category: 'earrings' | 'necklaces' | 'rings' | 'sets' = 'earrings',
  anchor: TryOnAnchor = 'unspecified',
): ArAsset {
  const built = arAssetFor({ category, tryOnAsset: { kind, url: 'https://example.test/a', anchor } })
  if (!built) throw new Error(`expected an asset for ${category}/${kind}`)
  return built
}

const VALID: AssetValidation = { status: 'valid' }
const INVALID: AssetValidation = { status: 'invalid', reason: 'the first chunk is not JSON' }
const UNCHECKED: AssetValidation = { status: 'unchecked' }

describe('chooseRenderer — the implemented path', () => {
  it('draws a 2D image with Canvas 2D and no caveat', () => {
    const choice = chooseRenderer(asset('image'), UNCHECKED)
    expect(choice.renderer).toBe('canvas2d')
    /* A `reason` here would put an apology under a piece that works perfectly. */
    expect(choice.reason).toBeNull()
  })

  it('sends a validated glb to the 3D renderer with no caveat', () => {
    const choice = chooseRenderer(asset('glb'), VALID)
    expect(choice.renderer).toBe('three')
    expect(choice.reason).toBeNull()
  })
})

describe('chooseRenderer — the 3D gate', () => {
  /* The spec's rule made executable: a 3D URL is not evidence of a 3D model. */
  it('does not reach 3D from an unvalidated glb', () => {
    const choice = chooseRenderer(asset('glb'), UNCHECKED)
    expect(choice.renderer).toBe('none')
    expect(choice.reason).toContain('not been verified')
  })

  it('declines a broken model, quoting the measurement', () => {
    const choice = chooseRenderer(asset('glb'), INVALID)
    expect(choice.renderer).toBe('none')
    /* The reason string is the specific failure, not a generic "could not load" — a seller reading it
       in the console can act on it. */
    expect(choice.reason).toContain('the first chunk is not JSON')
  })

  /* Pins the correction above. `drawImage` cannot draw a `.glb`, and an `ArAsset` has one URL, so a
     "flat overlay" fallback would name a renderer that fails at load. This asserts the invariant for
     every non-valid glb at once, so adding a validation status later cannot quietly reintroduce one. */
  it('never names a renderer that cannot draw the asset it was chosen for', () => {
    for (const validation of [INVALID, UNCHECKED]) {
      expect(chooseRenderer(asset('glb'), validation).renderer).not.toBe('canvas2d')
    }
  })

  it('refuses usdz outright, with a reason', () => {
    const choice = chooseRenderer(asset('usdz'), UNCHECKED)
    expect(choice.renderer).toBe('none')
    expect(choice.reason).toContain('USDZ')
  })
})

describe('chooseRenderer — categories', () => {
  it('refuses every category that is not implemented', () => {
    for (const choice of [chooseRenderer(asset('image', 'necklaces'), UNCHECKED), chooseRenderer(asset('image', 'rings'), UNCHECKED)]) {
      expect(choice.renderer).toBe('none')
      expect(choice.reason).toBe(UNSUPPORTED_CATEGORY_REASON)
    }
  })

  it('reports the category problem before the asset problem', () => {
    /* A broken glb in an unsupported category should not send the seller hunting for a bad model.
       The category is the actionable fact, so it wins. */
    const choice = chooseRenderer(asset('glb', 'necklaces'), INVALID)
    expect(choice.renderer).toBe('none')
    expect(choice.reason).toBe(UNSUPPORTED_CATEGORY_REASON)
  })

  /* Two modules answer "which categories work?" — the renderer gate and the solver registry — and a
     category that passes one but not the other is the worst of both: the page reports a working
     try-on and then draws nothing. Pinned together so they cannot drift. */
  it('agrees with the registry about what is implemented', () => {
    expect(IMPLEMENTED_AR_CATEGORIES).toEqual(['earrings'])
    expect(implementedCategories()).toEqual([...IMPLEMENTED_AR_CATEGORIES])

    expect(isImplemented(asset('image'))).toBe(true)
    expect(isImplemented(asset('image', 'necklaces'))).toBe(false)
  })

  /* And a third: `lib/catalog` now states the same fact, because the storefront has to decide whether
     to offer a "Try it on" button and must not import from this feature to find out. Three statements
     of one fact is two too many, so this asserts they are the same statement. A drift here is the
     visible failure — a button on a product page leading to "not available for this category". */
  it('agrees with the catalogue about which categories have a try-on experience', () => {
    expect(TRYON_READY_CATEGORIES).toEqual(['earrings'])

    for (const category of Object.keys(CATEGORIES) as CategoryKey[]) {
      const built = arAssetFor({ category, tryOnAsset: { kind: 'image', url: 'x', anchor: 'unspecified' } })
      const engineCanDraw = built !== null && isImplemented(built)
      expect(hasTryOnExperience(category)).toBe(engineCanDraw)
    }
  })

  it('never constructs an asset for a category with no strategy at all', () => {
    expect(arAssetFor({ category: 'sets', tryOnAsset: { kind: 'image', url: 'x', anchor: 'unspecified' } })).toBeNull()
  })
})

describe('chooseRenderer — the anchor conflict', () => {
  it('accepts an unspecified anchor, falling back to the category default', () => {
    const choice = chooseRenderer(asset('image', 'earrings', 'unspecified'), UNCHECKED)
    expect(choice.renderer).toBe('canvas2d')
  })

  it('accepts an anchor that matches the category requirement', () => {
    expect(chooseRenderer(asset('image', 'earrings', 'ear'), UNCHECKED).renderer).toBe('canvas2d')
  })

  /* The seller says wrist, earring try-on places at the ear. Guessing over a stated answer is worse
     than declining, so it declines — and names both sides so the fix is obvious. */
  it('refuses an anchor that contradicts the category, naming both sides', () => {
    const choice = chooseRenderer(asset('image', 'earrings', 'wrist'), UNCHECKED)

    expect(choice.renderer).toBe('none')
    expect(choice.reason).toContain('wrist')
    expect(choice.reason).toContain('ear')
  })

  it('refuses a conflicting anchor on a glb too, before validation is consulted', () => {
    const choice = chooseRenderer(asset('glb', 'earrings', 'neck'), VALID)
    expect(choice.renderer).toBe('none')
    expect(choice.reason).toContain('neck')
  })
})
