import { describe, expect, it } from 'vitest'
import { freshCatchUp, noteConnected, takeSnapshot } from './takeSnapshot'

describe('takeSnapshot', () => {
  it('replaces local state from the snapshot on a new socket, then ignores an older seq', () => {
    const first = takeSnapshot(freshCatchUp(), 4)
    expect(first.apply).toBe(true)
    expect(first.catchUp).toEqual({ seq: 4, replace: false })

    const stale = takeSnapshot(first.catchUp, 3)
    expect(stale.apply).toBe(false)
    expect(stale.catchUp).toEqual({ seq: 4, replace: false })

    const same = takeSnapshot(first.catchUp, 4)
    expect(same.apply).toBe(true)

    const rejoined = takeSnapshot(noteConnected(first.catchUp), 1)
    expect(rejoined.apply).toBe(true)
    expect(rejoined.catchUp).toEqual({ seq: 1, replace: false })
  })
})
