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

export type Bid = {
  seq: number
  participantId: ParticipantId
  amount: number
  at: number
}

export type AuctionState =
  | { stage: 'absent'; terms: null; endsAt: null }
  | { stage: 'awaiting'; terms: AuctionTerms; endsAt: null }
  | { stage: 'live'; terms: AuctionTerms; endsAt: number; leader: Leader | null; bids: Bid[] }
  | { stage: 'closed'; terms: AuctionTerms; endsAt: number; leader: Leader | null; bids: Bid[] }

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
  if (isSeller(command.actorId)) return reject(state, 'not_buyer')
  if (state.stage === 'closed') return reject(state, 'lot_closed')
  if (state.stage !== 'live') return reject(state, 'not_started')
  if (!Number.isSafeInteger(command.amount)) return reject(state, 'not_integer')
  if (state.leader?.participantId === command.actorId) return reject(state, 'already_leader')
  if (command.amount < nextAmount(state)) return reject(state, 'below_min')
  if (command.amount % state.terms.minStep !== 0) return reject(state, 'not_multiple')

  const bid: Bid = {
    seq: state.bids.length + 1,
    participantId: command.actorId,
    amount: command.amount,
    at: now,
  }
  return accept({
    ...state,
    leader: { participantId: command.actorId, amount: command.amount },
    bids: [...state.bids, bid],
  })
}

function isSeller(actorId: ParticipantId): boolean {
  return actorId === 's'
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
