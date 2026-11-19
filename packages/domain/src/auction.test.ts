import { describe, expect, it } from 'vitest'
import {
  STAGE_LABEL,
  apply,
  bidBlockReason,
  emptyAuction,
  type ApplyResult,
  type AuctionCommand,
  type AuctionState,
} from './auction'

const T0 = 1_700_000_000_000

const createLot: AuctionCommand = {
  type: 'create',
  actorId: 's',
  startingPrice: 10_000,
  minStep: 1_000,
  durationMinutes: 2,
}

function taken(result: ApplyResult): AuctionState {
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

function refused(result: ApplyResult) {
  if (result.ok) throw new Error('expected a refusal')
  return result
}

describe('auction lifecycle', () => {
  it('names the four stages the way the screen will', () => {
    expect(STAGE_LABEL).toEqual({
      absent: 'Не создан',
      awaiting: 'Ожидает запуска',
      live: 'Идут торги',
      closed: 'Завершён',
    })
  })

  it('starts with no lot', () => {
    expect(emptyAuction()).toEqual({ stage: 'absent', terms: null, endsAt: null })
    expect(bidBlockReason(emptyAuction())).toBe('not_started')
  })

  it('lets the seller create a lot and keeps bids closed until launch', () => {
    const created = taken(apply(emptyAuction(), createLot, T0))

    expect(created).toEqual({
      stage: 'awaiting',
      terms: { startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 },
      endsAt: null,
    })
    expect(bidBlockReason(created)).toBe('not_started')
    expect(emptyAuction().stage).toBe('absent')
  })

  it('rejects a second create, a buyer, and bad terms without touching state', () => {
    const waiting = taken(apply(emptyAuction(), createLot, T0))

    const again = refused(apply(waiting, createLot, T0))
    expect(again.reason).toBe('wrong_stage')
    expect(again.state).toBe(waiting)

    const buyer = refused(apply(emptyAuction(), { ...createLot, actorId: 'a' }, T0))
    expect(buyer.reason).toBe('not_seller')
    expect(buyer.state).toEqual(emptyAuction())

    expect(refused(apply(emptyAuction(), { ...createLot, startingPrice: 10.5 }, T0)).reason).toBe('not_integer')
    expect(refused(apply(emptyAuction(), { ...createLot, minStep: Number.NaN }, T0)).reason).toBe('not_integer')
    expect(refused(apply(emptyAuction(), { ...createLot, startingPrice: 0 }, T0)).reason).toBe('below_min')
    expect(refused(apply(emptyAuction(), { ...createLot, minStep: -1 }, T0)).reason).toBe('below_min')
    expect(refused(apply(emptyAuction(), { ...createLot, startingPrice: 1.5, durationMinutes: 0 }, T0)).reason).toBe(
      'not_integer',
    )
    expect(refused(apply(emptyAuction(), { ...createLot, durationMinutes: 0 }, T0)).reason).toBe('bad_duration')
    expect(refused(apply(emptyAuction(), { ...createLot, durationMinutes: 1441 }, T0)).reason).toBe('bad_duration')
    expect(refused(apply(emptyAuction(), { ...createLot, durationMinutes: 1.5 }, T0)).reason).toBe('bad_duration')

    const shortest = taken(apply(emptyAuction(), { ...createLot, durationMinutes: 1 }, T0))
    const longest = taken(apply(emptyAuction(), { ...createLot, durationMinutes: 1440 }, T0))
    expect(shortest.stage).toBe('awaiting')
    expect(longest.terms?.durationMinutes).toBe(1440)
  })

  it('opens the round from the server clock and then refuses another launch', () => {
    const waiting = taken(apply(emptyAuction(), createLot, T0))

    const early = refused(apply(emptyAuction(), { type: 'launch', actorId: 's' }, T0))
    expect(early.reason).toBe('wrong_stage')

    const buyer = refused(apply(waiting, { type: 'launch', actorId: 'b' }, T0))
    expect(buyer.reason).toBe('not_seller')
    expect(buyer.state).toBe(waiting)

    const live = taken(apply(waiting, { type: 'launch', actorId: 's' }, T0))
    expect(live).toEqual({
      stage: 'live',
      terms: { startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 },
      endsAt: T0 + 2 * 60_000,
    })
    expect(waiting.endsAt).toBeNull()
    expect(bidBlockReason(live)).toBeNull()

    expect(refused(apply(live, { type: 'launch', actorId: 's' }, T0 + 1_000)).reason).toBe('wrong_stage')
  })

  it('closes a live round in place and keeps the terms', () => {
    const live = taken(
      apply(taken(apply(emptyAuction(), createLot, T0)), { type: 'launch', actorId: 's' }, T0),
    )

    expect(refused(apply(emptyAuction(), { type: 'finish', actorId: 's' }, T0)).reason).toBe('wrong_stage')
    const buyer = refused(apply(live, { type: 'finish', actorId: 'a' }, T0 + 5_000))
    expect(buyer.reason).toBe('not_seller')
    expect(buyer.state).toBe(live)

    const closed = taken(apply(live, { type: 'finish', actorId: 's' }, T0 + 5_000))
    expect(closed.stage).toBe('closed')
    expect(closed.terms).toEqual(live.terms)
    expect(closed.endsAt).toBe(live.endsAt)
    expect(bidBlockReason(closed)).toBe('lot_closed')
    expect(refused(apply(closed, { type: 'finish', actorId: 's' }, T0)).reason).toBe('wrong_stage')
  })

  it('restarts only a live or closed round and waits for a new launch', () => {
    const waiting = taken(apply(emptyAuction(), createLot, T0))
    const live = taken(apply(waiting, { type: 'launch', actorId: 's' }, T0))

    expect(refused(apply(emptyAuction(), { type: 'restart', actorId: 's' }, T0)).reason).toBe('wrong_stage')
    expect(refused(apply(waiting, { type: 'restart', actorId: 's' }, T0)).reason).toBe('wrong_stage')
    expect(refused(apply(live, { type: 'restart', actorId: 'a' }, T0)).reason).toBe('not_seller')

    const reset = taken(apply(live, { type: 'restart', actorId: 's' }, T0 + 10_000))
    expect(reset).toEqual({
      stage: 'awaiting',
      terms: live.terms,
      endsAt: null,
    })
    expect(live.stage).toBe('live')
    expect(bidBlockReason(reset)).toBe('not_started')

    const relaunched = taken(apply(reset, { type: 'launch', actorId: 's' }, T0 + 60_000))
    expect(relaunched.endsAt).toBe(T0 + 60_000 + 2 * 60_000)

    const closed = taken(apply(relaunched, { type: 'finish', actorId: 's' }, T0 + 70_000))
    const afterClose = taken(apply(closed, { type: 'restart', actorId: 's' }, T0 + 80_000))
    expect(afterClose.stage).toBe('awaiting')
    expect(afterClose.terms).toEqual(createTerms())
    expect(afterClose.endsAt).toBeNull()
  })
})

function createTerms() {
  return { startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 }
}
