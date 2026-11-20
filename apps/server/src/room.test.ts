import { ANTI_SNIPE_MS, type BuyerSnapshot, type SellerSnapshot, type ServerMessage, type Snapshot } from '@auction/domain'
import { describe, expect, it } from 'vitest'
import { createRoom, type RoomClock } from './room'

const T0 = 1_700_000_000_000

const createLot = { type: 'create', startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 }

describe('room', () => {
  it('shows the two buyers and the seller different snapshots after one bid', () => {
    const desk = seated()
    desk.seller.send(createLot)
    desk.seller.send({ type: 'launch' })
    desk.buyerA.send({ type: 'place_bid', amount: 10_000, actorId: 's' })

    const buyerA = asBuyer(lastSnapshot(desk.buyerA))
    const buyerB = asBuyer(lastSnapshot(desk.buyerB))
    const seller = asSeller(lastSnapshot(desk.seller))

    expect(buyerA.seq).toBe(seller.seq)
    expect(buyerB.seq).toBe(seller.seq)
    expect(buyerA.amount).toBe(10_000)
    expect(buyerB.amount).toBe(10_000)
    expect(seller.amount).toBe(10_000)
    expect(buyerA.youLead).toBe(true)
    expect(buyerB.youLead).toBe(false)
    expect(buyerA.autobids).toEqual([])
    expect(buyerB.autobids).toEqual([])
    expect(buyerA).not.toHaveProperty('leader')
    expect(buyerA).not.toHaveProperty('bids')
    expect(JSON.stringify(buyerB)).not.toContain('Покупатель 1')

    expect(seller.leader).toEqual({ participantId: 'a', name: 'Покупатель 1' })
    expect(seller.bids).toEqual([
      {
        seq: 1,
        participantId: 'a',
        name: 'Покупатель 1',
        amount: 10_000,
        at: T0,
        source: 'manual',
      },
    ])
    expect(seller).not.toHaveProperty('autobroker')
    expect(desk.buyerA.sent.some((message) => message.type === 'rejected')).toBe(false)
    expect(desk.buyerB.sent.some((message) => message.type === 'rejected')).toBe(false)
  })

  it('sends a refusal only to the bidder and still publishes a clock close', () => {
    const desk = seated()
    desk.seller.send(createLot)
    desk.seller.send({ type: 'launch' })

    const buyerBBefore = desk.buyerB.sent.length
    const sellerBefore = desk.seller.sent.length
    desk.buyerA.send({ type: 'place_bid', amount: 1 })
    expect(desk.buyerA.sent.at(-1)).toEqual({ type: 'rejected', reason: 'below_min', command: 'place_bid' })
    expect(desk.buyerB.sent).toHaveLength(buyerBBefore)
    expect(desk.seller.sent).toHaveLength(sellerBefore)

    desk.seller.send({ type: 'place_bid', amount: 10_000 })
    expect(desk.seller.sent.at(-1)).toEqual({ type: 'rejected', reason: 'not_buyer', command: 'place_bid' })

    const stray = desk.open()
    stray.send({ type: 'launch' })
    stray.sendRaw('{')
    stray.sendRaw('{"type":"join","participantId":"z"}')
    expect(stray.sent).toEqual([
      { type: 'rejected', reason: 'bad_message' },
      { type: 'rejected', reason: 'bad_message' },
      { type: 'rejected', reason: 'unknown_participant' },
    ])
    expect(asSeller(lastSnapshot(desk.seller)).stage).toBe('live')

    desk.clock.set(T0 + 2 * 60_000)
    desk.buyerA.send({ type: 'place_bid', amount: 10_000 })
    expect(asBuyer(lastSnapshot(desk.buyerB)).stage).toBe('closed')
    expect(asSeller(lastSnapshot(desk.seller)).bids).toEqual([])
    expect(desk.buyerA.sent.at(-1)).toEqual({ type: 'rejected', reason: 'lot_closed', command: 'place_bid' })
    expect(desk.buyerB.sent.at(-1)?.type).toBe('snapshot')
    expect(desk.seller.sent.at(-1)?.type).toBe('snapshot')
  })

  it('keeps the autobroker ceiling on the sender and shows the reply to everyone else', () => {
    const desk = seated()
    desk.seller.send(createLot)
    desk.seller.send({ type: 'launch' })
    desk.buyerA.send({ type: 'place_bid', amount: 10_000 })
    desk.buyerB.send({ type: 'set_autobroker', maxAmount: 25_000 })

    const buyerA = asBuyer(lastSnapshot(desk.buyerA))
    const buyerB = asBuyer(lastSnapshot(desk.buyerB))
    const seller = asSeller(lastSnapshot(desk.seller))

    expect(buyerB.youLead).toBe(true)
    expect(buyerB.amount).toBe(11_000)
    expect(buyerB.autobroker).toEqual({ maxAmount: 25_000 })
    expect(buyerB.autobids).toEqual([{ seq: 2, amount: 11_000, at: T0 }])
    expect(desk.buyerB.sent.at(-1)).toEqual({ type: 'autobroker', maxAmount: 25_000 })

    expect(buyerA.amount).toBe(11_000)
    expect(buyerA.youLead).toBe(false)
    expect(buyerA.autobroker).toBeNull()
    expect(buyerA.autobids).toEqual([])
    expect(JSON.stringify(buyerA)).not.toContain('25000')
    expect(desk.buyerA.sent.some((message) => message.type === 'autobroker')).toBe(false)

    expect(seller.leader).toEqual({ participantId: 'b', name: 'Покупатель 2' })
    expect(seller.bids.map((bid) => [bid.participantId, bid.amount, bid.source])).toEqual([
      ['a', 10_000, 'manual'],
      ['b', 11_000, 'autobroker'],
    ])
    expect(JSON.stringify(seller)).not.toContain('25000')
    expect(desk.seller.sent.some((message) => message.type === 'autobroker')).toBe(false)

    desk.buyerB.send({ type: 'remove_autobroker' })
    expect(desk.buyerB.sent.at(-1)).toEqual({ type: 'autobroker', maxAmount: null })
    expect(asBuyer(lastSnapshot(desk.buyerB)).autobroker).toBeNull()
    expect(asBuyer(lastSnapshot(desk.buyerB)).autobids).toEqual([{ seq: 2, amount: 11_000, at: T0 }])
    expect(JSON.stringify(asBuyer(lastSnapshot(desk.buyerA)))).not.toContain('25000')
    expect(JSON.stringify(asSeller(lastSnapshot(desk.seller)))).not.toContain('25000')
  })

  it('takes presence from the open sockets', () => {
    const desk = seated()
    expect(asBuyer(lastSnapshot(desk.buyerA)).onlineParticipantIds).toEqual(['a', 'b', 's'])

    const beforeClose = desk.buyerB.sent.length
    desk.buyerB.close()
    expect(desk.buyerB.sent).toHaveLength(beforeClose)
    expect(asBuyer(lastSnapshot(desk.buyerA)).onlineParticipantIds).toEqual(['a', 's'])
    expect(asSeller(lastSnapshot(desk.seller)).onlineParticipantIds).toEqual(['a', 's'])
  })

  it('moves the one timer when endsAt shifts and closes through the domain', () => {
    const desk = seated()
    desk.seller.send(createLot)
    desk.seller.send({ type: 'launch' })
    expect(desk.clock.delay()).toBe(2 * 60_000)

    desk.clock.fire()
    expect(asSeller(lastSnapshot(desk.seller)).stage).toBe('live')
    expect(desk.clock.delay()).toBe(2 * 60_000)

    const endsAt = asSeller(lastSnapshot(desk.seller)).endsAt
    if (endsAt === null) throw new Error('expected a live end')
    desk.clock.set(endsAt - 10_000)
    desk.buyerA.send({ type: 'place_bid', amount: 10_000 })
    expect(desk.clock.delay()).toBe(ANTI_SNIPE_MS)
    expect(asSeller(lastSnapshot(desk.seller)).endsAt).toBe(desk.clock.now() + ANTI_SNIPE_MS)

    desk.clock.set(desk.clock.now() + ANTI_SNIPE_MS)
    desk.clock.fire()
    expect(asBuyer(lastSnapshot(desk.buyerA)).stage).toBe('closed')
    expect(asBuyer(lastSnapshot(desk.buyerA)).youLead).toBe(true)
    expect(asBuyer(lastSnapshot(desk.buyerB)).stage).toBe('closed')
    expect(asSeller(lastSnapshot(desk.seller)).stage).toBe('closed')
    expect(asSeller(lastSnapshot(desk.seller)).leader).toEqual({ participantId: 'a', name: 'Покупатель 1' })
    expect(desk.clock.delay()).toBeNull()
  })

  it('runs create, launch, a manual bid, an autobroker reply, finish, restart, and launch again', () => {
    const desk = seated()
    desk.seller.send(createLot)
    expect(asBuyer(lastSnapshot(desk.buyerA)).stage).toBe('awaiting')
    expect(asBuyer(lastSnapshot(desk.buyerA)).terms).toEqual({
      startingPrice: 10_000,
      minStep: 1_000,
      durationMinutes: 2,
    })

    desk.seller.send({ type: 'launch' })
    desk.buyerB.send({ type: 'set_autobroker', maxAmount: 25_000 })
    expect(asBuyer(lastSnapshot(desk.buyerB)).autobids).toEqual([])

    desk.buyerA.send({ type: 'place_bid', amount: 10_000 })
    const buyerA = asBuyer(lastSnapshot(desk.buyerA))
    const buyerB = asBuyer(lastSnapshot(desk.buyerB))
    const seller = asSeller(lastSnapshot(desk.seller))
    expect(buyerA.amount).toBe(11_000)
    expect(buyerA.youLead).toBe(false)
    expect(buyerA.autobroker).toBeNull()
    expect(buyerB.youLead).toBe(true)
    expect(buyerB.autobids).toEqual([{ seq: 2, amount: 11_000, at: T0 }])
    expect(buyerB.autobroker).toEqual({ maxAmount: 25_000 })
    expect(seller.leader).toEqual({ participantId: 'b', name: 'Покупатель 2' })
    expect(seller.bids.map((bid) => [bid.participantId, bid.amount, bid.source])).toEqual([
      ['a', 10_000, 'manual'],
      ['b', 11_000, 'autobroker'],
    ])
    expect(JSON.stringify(buyerA)).not.toContain('25000')
    expect(JSON.stringify(seller)).not.toContain('25000')

    desk.seller.send({ type: 'finish' })
    expect(asBuyer(lastSnapshot(desk.buyerA)).stage).toBe('closed')
    expect(asBuyer(lastSnapshot(desk.buyerB)).youLead).toBe(true)
    expect(asSeller(lastSnapshot(desk.seller)).leader?.name).toBe('Покупатель 2')

    desk.seller.send({ type: 'restart' })
    const reset = asSeller(lastSnapshot(desk.seller))
    expect(reset.stage).toBe('awaiting')
    expect(reset.terms).toEqual({ startingPrice: 10_000, minStep: 1_000, durationMinutes: 2 })
    expect(reset.bids).toEqual([])
    expect(reset.leader).toBeNull()
    expect(asBuyer(lastSnapshot(desk.buyerA)).stage).toBe('awaiting')
    expect(asBuyer(lastSnapshot(desk.buyerB)).autobroker).toBeNull()
    expect(asBuyer(lastSnapshot(desk.buyerB)).autobids).toEqual([])

    desk.seller.send({ type: 'launch' })
    const again = asSeller(lastSnapshot(desk.seller))
    expect(again.stage).toBe('live')
    expect(again.bids).toEqual([])
    expect(again.leader).toBeNull()
    expect(asBuyer(lastSnapshot(desk.buyerB)).autobroker).toBeNull()
    expect(asBuyer(lastSnapshot(desk.buyerA)).amount).toBeNull()
  })
})

function seated() {
  const clock = fakeClock(T0)
  const room = createRoom(clock.clock)
  const buyerA = open(room)
  const buyerB = open(room)
  const seller = open(room)
  buyerA.send({ type: 'join', participantId: 'a' })
  buyerB.send({ type: 'join', participantId: 'b' })
  seller.send({ type: 'join', participantId: 's' })
  return {
    clock,
    buyerA,
    buyerB,
    seller,
    open: () => open(room),
  }
}

function open(room: ReturnType<typeof createRoom>) {
  let onMessage: ((text: string) => void) | null = null
  let onClose: (() => void) | null = null
  const sent: ServerMessage[] = []
  room.connect({
    send(data) {
      sent.push(JSON.parse(data) as ServerMessage)
    },
    onMessage(listener) {
      onMessage = listener
    },
    onClose(listener) {
      onClose = listener
    },
  })
  return {
    sent,
    send(body: unknown) {
      if (!onMessage) throw new Error('socket has no listener')
      onMessage(JSON.stringify(body))
    },
    sendRaw(text: string) {
      if (!onMessage) throw new Error('socket has no listener')
      onMessage(text)
    },
    close() {
      onClose?.()
    },
  }
}

function fakeClock(start: number) {
  let now = start
  const handles: { delay: number; run: () => void; cancelled: boolean }[] = []
  const clock: RoomClock = {
    now: () => now,
    schedule(delay, run) {
      const handle = {
        delay,
        run,
        cancelled: false,
        cancel() {
          handle.cancelled = true
        },
      }
      handles.push(handle)
      return handle
    },
  }
  return {
    clock,
    now: () => now,
    set(next: number) {
      now = next
    },
    delay() {
      return handles.filter((handle) => !handle.cancelled).at(-1)?.delay ?? null
    },
    fire() {
      const handle = handles.filter((item) => !item.cancelled).at(-1)
      if (!handle) throw new Error('no timer')
      handle.cancelled = true
      handle.run()
    },
  }
}

function lastSnapshot(client: { sent: ServerMessage[] }): Snapshot {
  const found = [...client.sent].reverse().find((message) => message.type === 'snapshot')
  if (!found || found.type !== 'snapshot') throw new Error('no snapshot')
  return found
}

function asBuyer(snapshot: Snapshot): BuyerSnapshot {
  if (snapshot.role !== 'buyer') throw new Error('expected a buyer snapshot')
  return snapshot
}

function asSeller(snapshot: Snapshot): SellerSnapshot {
  if (snapshot.role !== 'seller') throw new Error('expected a seller snapshot')
  return snapshot
}
