import { describe, expect, it } from 'vitest'
import {
  EFFECT_MODULES,
  filterResponse,
  parameterPosition,
  parameterValue,
} from './effectRack'

describe('effect rack parameter controls', () => {
  it('round-trips real render values through linear and logarithmic dials', () => {
    for (const m of EFFECT_MODULES)
      for (const p of m.parameters) {
        for (const v of [p.min, p.max, p.initial, (p.min + p.max) / 2])
          expect(
            Math.abs(parameterValue(p, parameterPosition(p, v)) - v),
          ).toBeLessThanOrEqual(p.step / 2 + 1e-6)
        expect(parameterValue(p, -1)).toBe(p.min)
        expect(parameterValue(p, 2)).toBe(p.max)
      }
  })
  it('plots an actual flat, high-pass, low-pass and shelving response', () => {
    expect(filterResponse(100, {})).toBe(0)
    expect(filterResponse(80, { highpass: 300 })).toBeLessThan(-20)
    expect(Math.abs(filterResponse(8000, { highpass: 300 }))).toBeLessThan(0.1)
    expect(filterResponse(8000, { lowpass: 500 })).toBeLessThan(-40)
    expect(filterResponse(20, { lowShelf: 6 })).toBeCloseTo(6, 2)
    expect(filterResponse(20000, { highShelf: -6 })).toBeCloseTo(-6, 2)
    expect(filterResponse(2000, { highpass: 300, highShelf: 6 })).toBeCloseTo(
      filterResponse(2000, { highpass: 300 }) +
        filterResponse(2000, { highShelf: 6 }),
      6,
    )
  })
})
