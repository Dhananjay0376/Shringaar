import { describe, expect, it } from 'vitest'

import { earringSolver } from '../anchors/earring'
import { implementedCategories, solverFor } from '../anchors/registry'
import { AR_CATEGORIES, arAssetFor, arCategoryFor } from '../types/asset'
import type { TryOnAnchor, TryOnAssetKind } from '@/lib/catalog'

describe('solverFor', () => {
  it('returns the earring solver for earrings', () => {
    expect(solverFor('earrings')).toBe(earringSolver)
  })

  /* The honest half. Every other category must be `null` — reporting "no targets found" for a
     necklace would render a working page with nothing on it, which reads as a try-on bug rather than
     as a feature that does not exist yet. */
  it('returns null for every category that is not implemented', () => {
    const unimplemented = AR_CATEGORIES.filter((category) => category !== 'earrings')
    expect(unimplemented.length).toBe(4)

    for (const category of unimplemented) {
      expect(solverFor(category)).toBeNull()
    }
  })

  it('reports exactly one implemented category', () => {
    expect(implementedCategories()).toEqual(['earrings'])
  })

  /* Guards the registry against drifting from its own table: every category claiming a solver must
     actually produce targets, rather than being listed and then returning nothing. */
  it('lists no category whose solver declares a different category', () => {
    for (const category of implementedCategories()) {
      expect(solverFor(category)?.category).toBe(category)
    }
  })
})

describe('arCategoryFor', () => {
  it('maps earrings to earrings', () => {
    expect(arCategoryFor('earrings')).toBe('earrings')
  })

  it('maps both neck-worn categories to one strategy', () => {
    /* A necklace and a pendant share an anchor. Two product categories, one AR behaviour — which is
       why this is a mapping and not a rename. */
    expect(arCategoryFor('necklaces')).toBe('necklace')
    expect(arCategoryFor('pendants')).toBe('necklace')
  })

  it('maps rings and bracelets', () => {
    expect(arCategoryFor('rings')).toBe('ring')
    expect(arCategoryFor('bracelets')).toBe('bracelet')
  })

  it('returns null for categories with no anchor strategy', () => {
    for (const category of ['noserings', 'bangles', 'anklets', 'sets', 'other'] as const) {
      expect(arCategoryFor(category)).toBeNull()
    }
  })
})

describe('arAssetFor', () => {
  function source(
    kind: TryOnAssetKind,
    url: string | null,
    anchor: TryOnAnchor = 'unspecified',
    category: Parameters<typeof arCategoryFor>[0] = 'earrings',
  ) {
    return { category, tryOnAsset: { kind, url, anchor } }
  }

  it('builds an asset for a stored image', () => {
    const asset = arAssetFor(source('image', 'https://example.test/a.png'))
    expect(asset).not.toBeNull()
    expect(asset?.kind).toBe('image')
    expect(asset?.arCategory).toBe('earrings')
  })

  it('fills an unspecified anchor from the category default', () => {
    const asset = arAssetFor(source('image', 'https://example.test/a.png', 'unspecified'))
    expect(asset?.declaredAnchor).toBe('unspecified')
    expect(asset?.anchor).toBe('ear')
  })

  it('keeps an explicitly stated anchor, even one that conflicts', () => {
    /* Not corrected here. `chooseRenderer` refuses it and says why; silently rewriting the seller's
       answer would hide a real disagreement between what they said and what the engine does. */
    const asset = arAssetFor(source('image', 'https://example.test/a.png', 'wrist'))
    expect(asset?.declaredAnchor).toBe('wrist')
    expect(asset?.anchor).toBe('wrist')
  })

  /* A `.glb` picked in the form before storage exists records the *choice* and no bytes. Rendering
     it would be claiming an asset that is not there. */
  it('refuses an asset whose URL was never stored', () => {
    expect(arAssetFor(source('glb', null))).toBeNull()
  })

  it('refuses a kind of none', () => {
    expect(arAssetFor(source('none', 'https://example.test/a.png'))).toBeNull()
  })

  it('refuses a category with no AR strategy, even with a good asset', () => {
    expect(arAssetFor(source('image', 'https://example.test/a.png', 'unspecified', 'sets'))).toBeNull()
  })

  it('treats missing input as no asset rather than throwing', () => {
    expect(arAssetFor(null)).toBeNull()
    expect(arAssetFor(undefined)).toBeNull()
    expect(arAssetFor({ category: 'earrings', tryOnAsset: null })).toBeNull()
  })
})
