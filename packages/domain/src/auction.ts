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

export type AuctionState =
  | { stage: 'absent'; terms: null; endsAt: null }
  | { stage: 'awaiting'; terms: AuctionTerms; endsAt: null }
  | { stage: 'live'; terms: AuctionTerms; endsAt: number }
  | { stage: 'closed'; terms: AuctionTerms; endsAt: number }

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

export type RejectReason =
  | 'not_integer'
  | 'below_min'
  | 'bad_duration'
  | 'wrong_stage'
  | 'not_seller'
  | 'not_started'
  | 'lot_closed'

export type ApplyResult =
  | { ok: true; state: AuctionState }
  | { ok: false; reason: RejectReason; state: AuctionState }

export function emptyAuction(): AuctionState {
  return { stage: 'absent', terms: null, endsAt: null }
}

/** Ставку можно принять только на стадии «Идут торги». Сумму проверяет следующий шаг. */
export function bidBlockReason(state: AuctionState): 'not_started' | 'lot_closed' | null {
  if (state.stage === 'live') return null
  if (state.stage === 'closed') return 'lot_closed'
  return 'not_started'
}

export function apply(state: AuctionState, command: AuctionCommand, now: number): ApplyResult {
  if (command.type === 'create') return applyCreate(state, command)
  if (command.type === 'launch') return applyLaunch(state, command, now)
  if (command.type === 'finish') return applyFinish(state, command)
  return applyRestart(state, command)
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
  })
}

function applyFinish(state: AuctionState, command: Extract<AuctionCommand, { type: 'finish' }>): ApplyResult {
  if (!isSeller(command.actorId)) return reject(state, 'not_seller')
  if (state.stage !== 'live') return reject(state, 'wrong_stage')

  return accept({
    stage: 'closed',
    terms: { ...state.terms },
    endsAt: state.endsAt,
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
