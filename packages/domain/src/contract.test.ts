import { describe, expect, it } from 'vitest'
import { apply, emptyAuction, type ApplyResult, type AuctionState } from './auction'
import { parseClientMessage, toAuctionCommand, type ClientCommand, type ClientMessage } from './messages'
import { project, type BuyerSnapshot, type ProjectContext, type SellerSnapshot } from './project'

const T0 = 1_700_000_000_000

const room: ProjectContext = {
  seq: 4,
  serverNow: T0 + 50,
  onlineParticipantIds: ['b', 'a', 's'],
}

describe('projection', () => {
  it('shows an unopened lot without a price, a tape, or a ceiling', () => {
    const quiet = { seq: 0, serverNow: T0, onlineParticipantIds: [] as const }

    expect(project(emptyAuction(), 'a', quiet)).toEqual({
      type: 'snapshot',
      role: 'buyer',
      seq: 0,
      serverNow: T0,
      stage: 'absent',
      terms: null,
      endsAt: null,
      amount: null,
      onlineParticipantIds: [],
      youLead: false,
      autobids: [],
      autobroker: null,
    })

    expect(project(emptyAuction(), 's', quiet)).toEqual({
      type: 'snapshot',
      role: 'seller',
      seq: 0,
      serverNow: T0,
      stage: 'absent',
      terms: null,
      endsAt: null,
      amount: null,
      onlineParticipantIds: [],
      leader: null,
      bids: [],
    })
  })

  it('shares the saved terms before the round starts', () => {
    const waiting = taken(
      apply(
        emptyAuction(),
        { type: 'create', actorId: 's', startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 },
        T0,
      ),
    )
    const buyer = asBuyer(project(waiting, 'b', room))
    const seller = asSeller(project(waiting, 's', room))

    expect(buyer.stage).toBe('awaiting')
    expect(buyer.terms).toEqual({ startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 })
    expect(buyer.endsAt).toBeNull()
    expect(buyer.amount).toBeNull()
    expect(buyer.youLead).toBe(false)
    expect(buyer.autobids).toEqual([])
    expect(buyer.autobroker).toBeNull()
    expect(buyer).not.toHaveProperty('leader')
    expect(buyer).not.toHaveProperty('bids')

    expect(seller.terms).toEqual(buyer.terms)
    expect(seller.leader).toBeNull()
    expect(seller.bids).toEqual([])
    expect(seller).not.toHaveProperty('autobroker')
    expect(seller).not.toHaveProperty('autobids')
  })

  it('hides the tape, the leader name, and the other ceiling from a buyer', () => {
    const state = liveWithBrokers()
    const buyerA = asBuyer(project(state, 'a', room))
    const buyerB = asBuyer(project(state, 'b', room))

    expect(buyerA).toEqual({
      type: 'snapshot',
      role: 'buyer',
      seq: 4,
      serverNow: T0 + 50,
      stage: 'live',
      terms: { startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 },
      endsAt: state.endsAt,
      amount: 14_000,
      onlineParticipantIds: ['b', 'a', 's'],
      youLead: false,
      autobids: [
        { seq: 2, amount: 11_000, at: T0 + 2 },
        { seq: 4, amount: 13_000, at: T0 + 3 },
      ],
      autobroker: { maxAmount: 25_000 },
    })
    expect(buyerB.youLead).toBe(true)
    expect(buyerB.amount).toBe(14_000)
    expect(buyerB.autobids).toEqual([
      { seq: 3, amount: 12_000, at: T0 + 3 },
      { seq: 5, amount: 14_000, at: T0 + 3 },
    ])
    expect(buyerB.autobroker).toEqual({ maxAmount: 14_000 })

    expect(JSON.stringify(buyerA)).not.toContain('Покупатель 2')
    expect(JSON.stringify(buyerB)).not.toContain('Покупатель 1')
    expect(JSON.stringify(buyerB)).not.toContain('25000')
    expect(buyerA).not.toHaveProperty('bids')
    expect(buyerA).not.toHaveProperty('leader')
  })

  it('gives the seller the tape and the leader name, and no ceilings', () => {
    const state = liveWithBrokers()
    const seller = asSeller(project(state, 's', room))

    expect(seller).toEqual({
      type: 'snapshot',
      role: 'seller',
      seq: 4,
      serverNow: T0 + 50,
      stage: 'live',
      terms: { startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 },
      endsAt: state.endsAt,
      amount: 14_000,
      onlineParticipantIds: ['b', 'a', 's'],
      leader: { participantId: 'b', name: 'Покупатель 2' },
      bids: [
        { seq: 1, participantId: 'b', name: 'Покупатель 2', amount: 10_000, at: T0 + 2, source: 'manual' },
        { seq: 2, participantId: 'a', name: 'Покупатель 1', amount: 11_000, at: T0 + 2, source: 'autobroker' },
        { seq: 3, participantId: 'b', name: 'Покупатель 2', amount: 12_000, at: T0 + 3, source: 'autobroker' },
        { seq: 4, participantId: 'a', name: 'Покупатель 1', amount: 13_000, at: T0 + 3, source: 'autobroker' },
        { seq: 5, participantId: 'b', name: 'Покупатель 2', amount: 14_000, at: T0 + 3, source: 'autobroker' },
      ],
    })
    expect(JSON.stringify(seller)).not.toContain('25000')
  })

  it('keeps the same privacy after the lot closes and drops bids on restart', () => {
    const live = liveWithBrokers()
    const closed = taken(apply(live, { type: 'finish', actorId: 's' }, T0 + 10))
    const winner = asBuyer(project(closed, 'b', room))
    const loser = asBuyer(project(closed, 'a', room))
    const seller = asSeller(project(closed, 's', room))

    expect(closed.stage).toBe('closed')
    expect(winner.youLead).toBe(true)
    expect(winner.amount).toBe(14_000)
    expect(winner.autobids).toHaveLength(2)
    expect(winner.autobroker).toEqual({ maxAmount: 14_000 })
    expect(loser.youLead).toBe(false)
    expect(loser.autobroker).toEqual({ maxAmount: 25_000 })
    expect(JSON.stringify(loser)).not.toContain('Покупатель 2')
    expect(seller.leader).toEqual({ participantId: 'b', name: 'Покупатель 2' })
    expect(seller.bids).toHaveLength(5)
    expect(JSON.stringify(seller)).not.toContain('25000')

    const reset = taken(apply(closed, { type: 'restart', actorId: 's' }, T0 + 11))
    const after = asBuyer(project(reset, 'a', room))
    expect(after.stage).toBe('awaiting')
    expect(after.terms).toEqual(live.terms)
    expect(after.amount).toBeNull()
    expect(after.autobids).toEqual([])
    expect(after.autobroker).toBeNull()
    expect(asSeller(project(reset, 's', room)).bids).toEqual([])
  })

  it('copies the terms, the tape, and the online list out of the room', () => {
    const state = liveWithBrokers()
    const online: ProjectContext['onlineParticipantIds'] = ['a']
    const seller = asSeller(project(state, 's', { seq: 1, serverNow: T0, onlineParticipantIds: online }))

    expect(seller.bids).not.toBe(state.bids)
    expect(seller.terms).not.toBe(state.terms)
    seller.bids[0].name = 'подмена'
    seller.onlineParticipantIds.push('b')
    if (seller.terms) seller.terms.startingPrice = 1

    expect(state.bids[0]).not.toHaveProperty('name')
    expect(state.terms.startingPrice).toBe(10_000)
    expect(online).toEqual(['a'])
    expect(asSeller(project(state, 's', { seq: 1, serverNow: T0, onlineParticipantIds: online })).bids[0].name).toBe(
      'Покупатель 2',
    )
  })
})

describe('client messages', () => {
  it('reads join and the commands the room will pass to apply', () => {
    const join = parsed('{"type":"join","participantId":"a","actorId":"s"}')
    expect(join).toEqual({ type: 'join', participantId: 'a' })

    const create = command('{"type":"create","startingPrice":10000,"minStep":1000,"durationMinutes":2,"actorId":"a"}')
    expect(toAuctionCommand(create, 's')).toEqual({
      type: 'create',
      actorId: 's',
      startingPrice: 10_000,
      minStep: 1_000,
      durationMinutes: 2,
    })

    expect(toAuctionCommand(command('{"type":"launch"}'), 's')).toEqual({ type: 'launch', actorId: 's' })
    expect(toAuctionCommand(command('{"type":"finish"}'), 's')).toEqual({ type: 'finish', actorId: 's' })
    expect(toAuctionCommand(command('{"type":"restart"}'), 's')).toEqual({ type: 'restart', actorId: 's' })
    expect(toAuctionCommand(command('{"type":"place_bid","amount":11000,"actorId":"s"}'), 'b')).toEqual({
      type: 'place_bid',
      actorId: 'b',
      amount: 11_000,
    })
    expect(toAuctionCommand(command('{"type":"set_autobroker","maxAmount":20000}'), 'a')).toEqual({
      type: 'set_autobroker',
      actorId: 'a',
      maxAmount: 20_000,
    })
    expect(toAuctionCommand(command('{"type":"remove_autobroker"}'), 'a')).toEqual({
      type: 'remove_autobroker',
      actorId: 'a',
    })

    const stillANumber = command('{"type":"place_bid","amount":10.5}')
    expect(stillANumber).toEqual({ type: 'place_bid', amount: 10.5 })
  })

  it('rejects broken JSON, an unknown command, and a participant the room does not have', () => {
    const broken = [
      '',
      '{',
      'null',
      '[]',
      '1',
      '"launch"',
      '{"type":"close_if_due"}',
      '{"type":"place_bid"}',
      '{"type":"place_bid","amount":"11000"}',
      '{"type":"create","startingPrice":1,"minStep":1}',
      '{"type":"set_autobroker"}',
      '{"type":"join"}',
      '{"type":"join","participantId":1}',
    ]
    for (const text of broken) {
      expect(parseClientMessage(text)).toEqual({ ok: false, reason: 'bad_message' })
    }

    expect(parseClientMessage('{"type":"join","participantId":"seller"}')).toEqual({
      ok: false,
      reason: 'unknown_participant',
    })
  })
})

function taken(result: ApplyResult): AuctionState {
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

function liveWithBrokers(): Extract<AuctionState, { stage: 'live' }> {
  const waiting = taken(
    apply(
      emptyAuction(),
      { type: 'create', actorId: 's', startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 },
      T0,
    ),
  )
  const live = taken(apply(waiting, { type: 'launch', actorId: 's' }, T0))
  const armed = taken(apply(live, { type: 'set_autobroker', actorId: 'a', maxAmount: 25_000 }, T0 + 1))
  const answered = taken(apply(armed, { type: 'place_bid', actorId: 'b', amount: 10_000 }, T0 + 2))
  const war = taken(apply(answered, { type: 'set_autobroker', actorId: 'b', maxAmount: 14_000 }, T0 + 3))
  if (war.stage !== 'live') throw new Error('expected a live lot')
  return war
}

function asBuyer(snapshot: BuyerSnapshot | SellerSnapshot): BuyerSnapshot {
  if (snapshot.role !== 'buyer') throw new Error('expected a buyer snapshot')
  return snapshot
}

function asSeller(snapshot: BuyerSnapshot | SellerSnapshot): SellerSnapshot {
  if (snapshot.role !== 'seller') throw new Error('expected a seller snapshot')
  return snapshot
}

function parsed(text: string): ClientMessage {
  const result = parseClientMessage(text)
  if (!result.ok) throw new Error(result.reason)
  return result.message
}

function command(text: string): ClientCommand {
  const message = parsed(text)
  if (message.type === 'join') throw new Error('expected a command')
  return message
}
