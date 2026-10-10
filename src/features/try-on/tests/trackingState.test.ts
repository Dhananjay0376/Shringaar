import { describe, expect, it } from 'vitest'

import {
  INITIAL_TRACKING_STATE,
  isTrackingRenderable,
  nextTrackingStatus,
  resetTracking,
  type TrackingState,
} from '../core/trackingState'
import { DEFAULT_TRACKING_CONFIG, type TrackingConfig } from '../types/frame'

const CONFIG: TrackingConfig = { acquireFrames: 3, holdFrames: 4 }

/** Feeds a run of `seen` flags from a starting state and returns every intermediate state. */
function feed(start: TrackingState, frames: readonly boolean[], config = CONFIG): TrackingState[] {
  const states: TrackingState[] = []
  let state = start
  for (const seen of frames) {
    state = nextTrackingStatus(state, seen, config)
    states.push(state)
  }
  return states
}

describe('nextTrackingStatus — acquiring', () => {
  it('stays acquiring below the acquisition count and is not renderable', () => {
    const states = feed(INITIAL_TRACKING_STATE, [true, true])

    expect(states.map((s) => s.status)).toEqual(['acquiring', 'acquiring'])
    for (const state of states) expect(isTrackingRenderable(state)).toBe(false)
  })

  it('reaches tracking on the acquisition-th consecutive detection', () => {
    const states = feed(INITIAL_TRACKING_STATE, [true, true, true])

    expect(states.map((s) => s.status)).toEqual(['acquiring', 'acquiring', 'tracking'])
    expect(isTrackingRenderable(states[2]!)).toBe(true)
  })

  /* One spurious frame of landmarks — a hand, a poster, a wall — must not put an earring on screen.
     Requiring a run is the whole reason this machine exists. */
  it('does not acquire from a single detection with a gap', () => {
    const states = feed(INITIAL_TRACKING_STATE, [true, true, false, true, true, true])

    expect(states[3]?.status).toBe('acquiring')
    expect(states[4]?.status).toBe('acquiring')
    expect(states[5]?.status).toBe('tracking')
  })

  it('resets the run on a miss but does not fall back to idle', () => {
    /* We have glimpsed something, so `idle` — which says we have not — would be a lie, and the two
       want different words on screen. */
    const state = nextTrackingStatus(
      nextTrackingStatus(INITIAL_TRACKING_STATE, true, CONFIG),
      false,
      CONFIG,
    )

    expect(state.status).toBe('acquiring')
    expect(state.hits).toBe(0)
  })

  it('never leaves idle without a detection', () => {
    const states = feed(INITIAL_TRACKING_STATE, [false, false, false])
    for (const state of states) expect(state.status).toBe('idle')
  })
})

describe('nextTrackingStatus — holding', () => {
  const tracking = nextTrackingStatus(
    nextTrackingStatus(nextTrackingStatus(INITIAL_TRACKING_STATE, true, CONFIG), true, CONFIG),
    true,
    CONFIG,
  )

  it('drops to holding on a single miss and stays renderable', () => {
    /* Blinks and momentary confidence dips are constant. Tearing the earring off screen for one
       frame is far more visible than leaving it where it was. */
    const state = nextTrackingStatus(tracking, false, CONFIG)

    expect(state.status).toBe('holding')
    expect(isTrackingRenderable(state)).toBe(true)
  })

  it('reaches lost only after the hold window is exhausted', () => {
    const states = feed(tracking, [false, false, false, false])

    expect(states.map((s) => s.status)).toEqual(['holding', 'holding', 'holding', 'lost'])
    expect(isTrackingRenderable(states[3]!)).toBe(false)
  })

  it('returns to tracking on a detection during holding', () => {
    const holding = nextTrackingStatus(tracking, false, CONFIG)
    const recovered = nextTrackingStatus(holding, true, CONFIG)

    expect(recovered.status).toBe('tracking')
    expect(recovered.misses).toBe(0)
    /* Recovery must not require re-acquiring — making the customer hold still again after every
       blink would look like the app had forgotten them. */
    expect(isTrackingRenderable(recovered)).toBe(true)
  })

  it('does not accumulate misses across recoveries', () => {
    let state = tracking
    for (let i = 0; i < 20; i += 1) {
      state = nextTrackingStatus(state, false, CONFIG)
      state = nextTrackingStatus(state, true, CONFIG)
    }
    expect(state.status).toBe('tracking')
  })
})

describe('nextTrackingStatus — lost', () => {
  it('stays lost while nothing is detected', () => {
    const lost = feed(
      nextTrackingStatus(
        nextTrackingStatus(nextTrackingStatus(INITIAL_TRACKING_STATE, true, CONFIG), true, CONFIG),
        true,
        CONFIG,
      ),
      [false, false, false, false],
    )[3]!

    expect(lost.status).toBe('lost')
    expect(nextTrackingStatus(lost, false, CONFIG).status).toBe('lost')
  })

  it('re-acquires from scratch after a detection', () => {
    const lost: TrackingState = { status: 'lost', hits: 0, misses: CONFIG.holdFrames }

    expect(nextTrackingStatus(lost, true, CONFIG).status).toBe('acquiring')
    expect(nextTrackingStatus(nextTrackingStatus(lost, true, CONFIG), true, CONFIG).status).toBe(
      'acquiring',
    )
  })
})

describe('resetTracking', () => {
  it('returns to idle and clears the acquired count', () => {
    const partial = nextTrackingStatus(INITIAL_TRACKING_STATE, true, CONFIG)
    expect(partial.hits).toBe(1)

    expect(resetTracking()).toEqual({ status: 'idle', hits: 0, misses: 0 })
  })
})

describe('defaults', () => {
  it('requires a run to acquire and tolerates a blink', () => {
    expect(DEFAULT_TRACKING_CONFIG.acquireFrames).toBeGreaterThan(1)
    expect(DEFAULT_TRACKING_CONFIG.holdFrames).toBeGreaterThan(1)
  })
})
