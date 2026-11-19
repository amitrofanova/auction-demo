import type { ParticipantId } from './participants'

export const MAX_DURATION_MINUTES = 1440
const MINUTE_MS = 60_000

export const STAGE_LABEL = {
  absent: 'Не создан',
  awaiting: 'Ожидает запуска',
  live: 'Идут торги',
  closed: 'Завершён',
} as const

export type AuctionTerms = {
  startingPrice: number
  minStep: number
  durationMinutes: number
}

export type Leader = {
  participantId: ParticipantId
  amount: number
}

export type BidSource = 'manual' | 'autobroker'

export type Bid = {
  seq: number
  participantId: ParticipantId
  amount: number
  at: number
  source: BidSource
}

export type Autobroker = {
  maxAmount: number
  setAt: number
}

export type BuyerId = 'a' | 'b'

export type Autobrokers = Partial<Record<BuyerId, Autobroker>>

export type AuctionState =
  | { stage: 'absent'; terms: null; endsAt: null }
  | { stage: 'awaiting'; terms: AuctionTerms; endsAt: null }
  | {
      stage: 'live'
      terms: AuctionTerms
      endsAt: number
      leader: Leader | null
      bids: Bid[]
      autobrokers: Autobrokers
    }
  | {
      stage: 'closed'
      terms: AuctionTerms
      endsAt: number
      leader: Leader | null
      bids: Bid[]
      autobrokers: Autobrokers
    }

export type AuctionCommand =
  | {
      type: 'create'
      actorId: ParticipantId
      startingPrice: number
      minStep: number
      durationMinutes: number
    }
  | { type: 'launch'; actorId: ParticipantId }
  | { type: 'finish'; actorId: ParticipantId }
  | { type: 'restart'; actorId: ParticipantId }
  | { type: 'place_bid'; actorId: ParticipantId; amount: number }
  | { type: 'set_autobroker'; actorId: ParticipantId; maxAmount: number }
  | { type: 'remove_autobroker'; actorId: ParticipantId }

export type RejectReason =
  | 'not_integer'
  | 'below_min'
  | 'not_multiple'
  | 'bad_duration'
  | 'wrong_stage'
  | 'not_seller'
  | 'not_buyer'
  | 'already_leader'
  | 'not_started'
  | 'lot_closed'
  | 'max_too_low'

export type ApplyResult =
  | { ok: true; state: AuctionState }
  | { ok: false; reason: RejectReason; state: AuctionState }

export function emptyAuction(): AuctionState {
  return { stage: 'absent', terms: null, endsAt: null }
}

/** Следующая сумма для поля: не ниже старта и шага, дальше не ниже лидера плюс шаг, и всегда кратна шагу. */
export function nextAmount(state: Extract<AuctionState, { stage: 'live' }>): number {
  const step = state.terms.minStep
  const floor = state.leader ? state.leader.amount + step : Math.max(state.terms.startingPrice, step)
  const remainder = floor % step
  return remainder === 0 ? floor : floor + (step - remainder)
}

export function apply(state: AuctionState, command: AuctionCommand, now: number): ApplyResult {
  switch (command.type) {
    case 'create':
      return applyCreate(state, command)
    case 'launch':
      return applyLaunch(state, command, now)
    case 'finish':
      return applyFinish(state, command)
    case 'restart':
      return applyRestart(state, command)
    case 'place_bid':
      return applyBid(state, command, now)
    case 'set_autobroker':
      return applySetAutobroker(state, command, now)
    case 'remove_autobroker':
      return applyRemoveAutobroker(state, command)
    default: {
      const unknown: never = command
      return unknown
    }
  }
}

function applyCreate(state: AuctionState, command: Extract<AuctionCommand, { type: 'create' }>): ApplyResult {
  if (!isSeller(command.actorId)) return reject(state, 'not_seller')
  if (state.stage !== 'absent') return reject(state, 'wrong_stage')
  if (!Number.isSafeInteger(command.startingPrice) || !Number.isSafeInteger(command.minStep)) {
    return reject(state, 'not_integer')
  }
  if (command.startingPrice <= 0 || command.minStep <= 0) return reject(state, 'below_min')
  if (!isDuration(command.durationMinutes)) return reject(state, 'bad_duration')

  return accept({
    stage: 'awaiting',
    terms: {
      startingPrice: command.startingPrice,
      minStep: command.minStep,
      durationMinutes: command.durationMinutes,
    },
    endsAt: null,
  })
}

function applyLaunch(
  state: AuctionState,
  command: Extract<AuctionCommand, { type: 'launch' }>,
  now: number,
): ApplyResult {
  if (!isSeller(command.actorId)) return reject(state, 'not_seller')
  if (state.stage !== 'awaiting') return reject(state, 'wrong_stage')

  return accept({
    stage: 'live',
    terms: { ...state.terms },
    endsAt: now + state.terms.durationMinutes * MINUTE_MS,
    leader: null,
    bids: [],
    autobrokers: {},
  })
}

function applyFinish(state: AuctionState, command: Extract<AuctionCommand, { type: 'finish' }>): ApplyResult {
  if (!isSeller(command.actorId)) return reject(state, 'not_seller')
  if (state.stage !== 'live') return reject(state, 'wrong_stage')

  return accept({
    stage: 'closed',
    terms: { ...state.terms },
    endsAt: state.endsAt,
    leader: state.leader ? { ...state.leader } : null,
    bids: state.bids.map((bid) => ({ ...bid })),
    autobrokers: copyAutobrokers(state.autobrokers),
  })
}

function applyRestart(state: AuctionState, command: Extract<AuctionCommand, { type: 'restart' }>): ApplyResult {
  if (!isSeller(command.actorId)) return reject(state, 'not_seller')
  if (state.stage !== 'live' && state.stage !== 'closed') return reject(state, 'wrong_stage')

  return accept({
    stage: 'awaiting',
    terms: { ...state.terms },
    endsAt: null,
  })
}

function applyBid(
  state: AuctionState,
  command: Extract<AuctionCommand, { type: 'place_bid' }>,
  now: number,
): ApplyResult {
  if (!isBuyer(command.actorId)) return reject(state, 'not_buyer')
  if (state.stage === 'closed') return reject(state, 'lot_closed')
  if (state.stage !== 'live') return reject(state, 'not_started')
  if (!Number.isSafeInteger(command.amount)) return reject(state, 'not_integer')
  if (state.leader?.participantId === command.actorId) return reject(state, 'already_leader')
  if (command.amount < nextAmount(state)) return reject(state, 'below_min')
  if (command.amount % state.terms.minStep !== 0) return reject(state, 'not_multiple')

  return accept(withChase(placeBid(state, command.actorId, command.amount, now, 'manual'), now))
}

function applySetAutobroker(
  state: AuctionState,
  command: Extract<AuctionCommand, { type: 'set_autobroker' }>,
  now: number,
): ApplyResult {
  if (!isBuyer(command.actorId)) return reject(state, 'not_buyer')
  if (state.stage === 'closed') return reject(state, 'lot_closed')
  if (state.stage !== 'live') return reject(state, 'not_started')
  if (!Number.isSafeInteger(command.maxAmount)) return reject(state, 'not_integer')

  const floor = state.leader?.participantId === command.actorId ? state.leader.amount : nextAmount(state)
  if (command.maxAmount < floor) return reject(state, 'max_too_low')

  const saved: Extract<AuctionState, { stage: 'live' }> = {
    ...state,
    autobrokers: {
      ...state.autobrokers,
      [command.actorId]: { maxAmount: command.maxAmount, setAt: now },
    },
  }
  return accept(withChase(saved, now))
}

function applyRemoveAutobroker(
  state: AuctionState,
  command: Extract<AuctionCommand, { type: 'remove_autobroker' }>,
): ApplyResult {
  if (!isBuyer(command.actorId)) return reject(state, 'not_buyer')
  if (state.stage === 'closed') return reject(state, 'lot_closed')
  if (state.stage !== 'live') return reject(state, 'not_started')
  if (!state.autobrokers[command.actorId]) return accept(state)

  const autobrokers = { ...state.autobrokers }
  delete autobrokers[command.actorId]
  return accept({ ...state, autobrokers })
}

function placeBid(
  state: Extract<AuctionState, { stage: 'live' }>,
  actorId: BuyerId,
  amount: number,
  now: number,
  source: BidSource,
): Extract<AuctionState, { stage: 'live' }> {
  const bid: Bid = {
    seq: state.bids.length + 1,
    participantId: actorId,
    amount,
    at: now,
    source,
  }
  return {
    ...state,
    leader: { participantId: actorId, amount },
    bids: [...state.bids, bid],
  }
}

function withChase(
  state: Extract<AuctionState, { stage: 'live' }>,
  now: number,
): Extract<AuctionState, { stage: 'live' }> {
  let current = state
  for (let guard = 0; guard < 100_000; guard += 1) {
    const actor = pickBroker(current)
    if (!actor) return current
    current = placeBid(current, actor, nextAmount(current), now, 'autobroker')
  }
  throw new Error('Autobroker did not stop')
}

function pickBroker(state: Extract<AuctionState, { stage: 'live' }>): BuyerId | null {
  const price = nextAmount(state)
  const bothOn = state.autobrokers.a !== undefined && state.autobrokers.b !== undefined
  if (!state.leader && !bothOn) return null
  if (bothOn && price > smallerCeiling(state)) return null

  const candidates = (['a', 'b'] as const).filter((id) => {
    const broker = state.autobrokers[id]
    return broker !== undefined && broker.maxAmount >= price && state.leader?.participantId !== id
  })
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const stepsUntilFinal = (finalWarPrice(state) - price) / state.terms.minStep
  const priority = priorityBuyer(state)
  return stepsUntilFinal % 2 === 0 ? priority : otherBuyer(priority)
}

function smallerCeiling(state: Extract<AuctionState, { stage: 'live' }>): number {
  return Math.min(state.autobrokers.a!.maxAmount, state.autobrokers.b!.maxAmount)
}

function finalWarPrice(state: Extract<AuctionState, { stage: 'live' }>): number {
  const price = nextAmount(state)
  const step = state.terms.minStep
  const cap = smallerCeiling(state)
  return cap - ((cap - price) % step)
}

function priorityBuyer(state: Extract<AuctionState, { stage: 'live' }>): BuyerId {
  const left = state.autobrokers.a!
  const right = state.autobrokers.b!
  if (left.maxAmount !== right.maxAmount) return left.maxAmount > right.maxAmount ? 'a' : 'b'
  if (left.setAt !== right.setAt) return left.setAt < right.setAt ? 'a' : 'b'
  return 'a'
}

function otherBuyer(id: BuyerId): BuyerId {
  return id === 'a' ? 'b' : 'a'
}

function copyAutobrokers(autobrokers: Autobrokers): Autobrokers {
  return {
    ...(autobrokers.a ? { a: { ...autobrokers.a } } : {}),
    ...(autobrokers.b ? { b: { ...autobrokers.b } } : {}),
  }
}

function isSeller(actorId: ParticipantId): boolean {
  return actorId === 's'
}

function isBuyer(actorId: ParticipantId): actorId is BuyerId {
  return actorId === 'a' || actorId === 'b'
}

function isDuration(minutes: number): boolean {
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_DURATION_MINUTES
}

function accept(state: AuctionState): ApplyResult {
  return { ok: true, state }
}

function reject(state: AuctionState, reason: RejectReason): ApplyResult {
  return { ok: false, reason, state }
}
