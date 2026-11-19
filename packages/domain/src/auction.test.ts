import { describe, expect, it } from 'vitest'
import {
  STAGE_LABEL,
  apply,
  emptyAuction,
  nextAmount,
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
  })

  it('lets the seller create a lot and keeps bids closed until launch', () => {
    const created = taken(apply(emptyAuction(), createLot, T0))

    expect(created).toEqual({
      stage: 'awaiting',
      terms: { startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 },
      endsAt: null,
    })
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
      leader: null,
      bids: [],
    })
    expect(waiting.endsAt).toBeNull()

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
    if (closed.stage !== 'closed') throw new Error('expected a closed lot')
    expect(closed.leader).toBeNull()
    expect(closed.bids).toEqual([])
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

describe('bids', () => {
  it('suggests the opening amount and then one step above the leader', () => {
    const live = openLot()
    expect(nextAmount(live)).toBe(10_000)

    const led = taken(apply(live, { type: 'place_bid', actorId: 'a', amount: 15_000 }, T0 + 1_000))
    if (led.stage !== 'live') throw new Error('expected a live lot')
    expect(nextAmount(led)).toBe(16_000)
  })

  it('accepts the opening bid and a later jump of several steps', () => {
    const live = openLot()
    const first = asLive(taken(apply(live, { type: 'place_bid', actorId: 'a', amount: 10_000 }, T0 + 1_000)))
    expect(first.leader).toEqual({ participantId: 'a', amount: 10_000 })
    expect(first.bids).toEqual([{ seq: 1, participantId: 'a', amount: 10_000, at: T0 + 1_000 }])
    expect(live.bids).toEqual([])
    expect(live.leader).toBeNull()

    const jumped = asLive(taken(apply(first, { type: 'place_bid', actorId: 'b', amount: 15_000 }, T0 + 2_000)))
    expect(jumped.leader).toEqual({ participantId: 'b', amount: 15_000 })
    expect(jumped.bids.map((bid) => bid.seq)).toEqual([1, 2])
  })

  it('refuses a seller, a closed round, and a round that has not started', () => {
    const live = openLot()
    const seller = refused(apply(live, { type: 'place_bid', actorId: 's', amount: 10_000 }, T0))
    expect(seller.reason).toBe('not_buyer')
    expect(seller.state).toBe(live)

    const before = refused(apply(emptyAuction(), { type: 'place_bid', actorId: 'a', amount: 10.5 }, T0))
    expect(before.reason).toBe('not_started')

    const waiting = taken(apply(emptyAuction(), createLot, T0))
    expect(refused(apply(waiting, { type: 'place_bid', actorId: 'b', amount: 10_000 }, T0)).reason).toBe('not_started')

    const closed = taken(apply(live, { type: 'finish', actorId: 's' }, T0 + 5_000))
    const late = refused(apply(closed, { type: 'place_bid', actorId: 'a', amount: 10_000 }, T0 + 6_000))
    expect(late.reason).toBe('lot_closed')
    expect(late.state).toBe(closed)
    expect(refused(apply(closed, { type: 'place_bid', actorId: 's', amount: 10_000 }, T0)).reason).toBe('not_buyer')
  })

  it('checks the amount only after the bidder is allowed to bid', () => {
    const live = openLot()
    const leader = taken(apply(live, { type: 'place_bid', actorId: 'a', amount: 10_000 }, T0 + 1_000))

    expect(refused(apply(leader, { type: 'place_bid', actorId: 'a', amount: 10.5 }, T0)).reason).toBe('not_integer')
    expect(refused(apply(leader, { type: 'place_bid', actorId: 'b', amount: Number.NaN }, T0)).reason).toBe('not_integer')
    expect(refused(apply(live, { type: 'place_bid', actorId: 'a', amount: 0 }, T0)).reason).toBe('below_min')
    expect(refused(apply(live, { type: 'place_bid', actorId: 'a', amount: 9_000 }, T0)).reason).toBe('below_min')
    expect(refused(apply(live, { type: 'place_bid', actorId: 'a', amount: 10_500 }, T0)).reason).toBe('not_multiple')

    const own = refused(apply(leader, { type: 'place_bid', actorId: 'a', amount: 11_000 }, T0 + 2_000))
    expect(own.reason).toBe('already_leader')
    expect(own.state).toBe(leader)

    expect(refused(apply(leader, { type: 'place_bid', actorId: 'b', amount: 10_500 }, T0)).reason).toBe('below_min')
    const answered = asLive(taken(apply(leader, { type: 'place_bid', actorId: 'b', amount: 11_000 }, T0 + 3_000)))
    expect(answered.leader).toEqual({ participantId: 'b', amount: 11_000 })
  })

  it('rounds the first bid up when the start is not a multiple of the step', () => {
    const waiting = taken(
      apply(emptyAuction(), { ...createLot, startingPrice: 10_000, minStep: 3_000 }, T0),
    )
    const live = taken(apply(waiting, { type: 'launch', actorId: 's' }, T0))
    if (live.stage !== 'live') throw new Error('expected a live lot')
    expect(nextAmount(live)).toBe(12_000)
    expect(refused(apply(live, { type: 'place_bid', actorId: 'a', amount: 10_000 }, T0)).reason).toBe('below_min')
    expect(refused(apply(live, { type: 'place_bid', actorId: 'a', amount: 13_000 }, T0)).reason).toBe('not_multiple')
    const accepted = asLive(taken(apply(live, { type: 'place_bid', actorId: 'a', amount: 15_000 }, T0 + 1)))
    expect(accepted.leader?.amount).toBe(15_000)
  })

  it('keeps bids after finish and drops them on restart', () => {
    const live = openLot()
    const led = taken(apply(live, { type: 'place_bid', actorId: 'a', amount: 12_000 }, T0 + 1_000))
    const closed = taken(apply(led, { type: 'finish', actorId: 's' }, T0 + 2_000))
    if (closed.stage !== 'closed') throw new Error('expected a closed lot')
    expect(closed.leader).toEqual({ participantId: 'a', amount: 12_000 })
    expect(closed.bids).toHaveLength(1)
    expect(led.stage).toBe('live')

    const reset = taken(apply(closed, { type: 'restart', actorId: 's' }, T0 + 3_000))
    expect(reset.stage).toBe('awaiting')
    expect(refused(apply(reset, { type: 'place_bid', actorId: 'b', amount: 12_000 }, T0)).reason).toBe('not_started')

    const again = asLive(taken(apply(reset, { type: 'launch', actorId: 's' }, T0 + 4_000)))
    expect(again.leader).toBeNull()
    expect(again.bids).toEqual([])
  })

  it('takes a first bid at the step when the step is above the start', () => {
    const waiting = taken(apply(emptyAuction(), { ...createLot, startingPrice: 500, minStep: 1_000 }, T0))
    const live = taken(apply(waiting, { type: 'launch', actorId: 's' }, T0))
    expect(refused(apply(live, { type: 'place_bid', actorId: 'a', amount: 500 }, T0)).reason).toBe('below_min')
    const accepted = asLive(taken(apply(live, { type: 'place_bid', actorId: 'a', amount: 1_000 }, T0 + 1)))
    expect(accepted.leader?.amount).toBe(1_000)
  })
})

function openLot(): Extract<AuctionState, { stage: 'live' }> {
  const waiting = taken(apply(emptyAuction(), createLot, T0))
  return asLive(taken(apply(waiting, { type: 'launch', actorId: 's' }, T0)))
}

function asLive(state: AuctionState): Extract<AuctionState, { stage: 'live' }> {
  if (state.stage !== 'live') throw new Error('expected a live lot')
  return state
}
