import type { AuctionCommand, RejectReason } from './auction'
import { participantById, type ParticipantId } from './participants'
import type { Snapshot } from './project'

/**
 * Команда с сокета. Роль есть только у join:
 * следующие сообщения её не несут, комнате её даёт уже открытое соединение.
 */
export type ClientMessage =
  | { type: 'join'; participantId: ParticipantId }
  | { type: 'create'; startingPrice: number; minStep: number; durationMinutes: number }
  | { type: 'launch' }
  | { type: 'finish' }
  | { type: 'restart' }
  | { type: 'place_bid'; amount: number }
  | { type: 'set_autobroker'; maxAmount: number }
  | { type: 'remove_autobroker' }

export type ClientCommand = Exclude<ClientMessage, { type: 'join' }>

export type ParseFailure = 'bad_message' | 'unknown_participant'

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; reason: ParseFailure }

export type ServerReason = RejectReason | ParseFailure

/** Отказ комната шлёт только отправителю. */
export type RejectedMessage = {
  type: 'rejected'
  reason: ServerReason
  command?: ClientCommand['type']
}

/** Потолок комната шлёт только отправителю. null — автоброкер выключен. */
export type AutobrokerStatusMessage = {
  type: 'autobroker'
  maxAmount: number | null
}

export type ServerMessage = Snapshot | RejectedMessage | AutobrokerStatusMessage

export function parseClientMessage(text: string): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'bad_message' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'bad_message' }

  const body = value as Record<string, unknown>
  switch (body.type) {
    case 'join':
      return parseJoin(body)
    case 'create':
      return parseCreate(body)
    case 'place_bid':
      return typeof body.amount === 'number'
        ? { ok: true, message: { type: 'place_bid', amount: body.amount } }
        : { ok: false, reason: 'bad_message' }
    case 'set_autobroker':
      return typeof body.maxAmount === 'number'
        ? { ok: true, message: { type: 'set_autobroker', maxAmount: body.maxAmount } }
        : { ok: false, reason: 'bad_message' }
    case 'launch':
    case 'finish':
    case 'restart':
    case 'remove_autobroker':
      return { ok: true, message: { type: body.type } }
    default:
      return { ok: false, reason: 'bad_message' }
  }
}

/** Дописывает участника соединения. Поля вроде actorId из JSON сюда не попадают. */
export function toAuctionCommand(message: ClientCommand, actorId: ParticipantId): AuctionCommand {
  switch (message.type) {
    case 'create':
      return {
        type: 'create',
        actorId,
        startingPrice: message.startingPrice,
        minStep: message.minStep,
        durationMinutes: message.durationMinutes,
      }
    case 'launch':
      return { type: 'launch', actorId }
    case 'finish':
      return { type: 'finish', actorId }
    case 'restart':
      return { type: 'restart', actorId }
    case 'place_bid':
      return { type: 'place_bid', actorId, amount: message.amount }
    case 'set_autobroker':
      return { type: 'set_autobroker', actorId, maxAmount: message.maxAmount }
    case 'remove_autobroker':
      return { type: 'remove_autobroker', actorId }
    default: {
      const unknown: never = message
      return unknown
    }
  }
}

function parseJoin(body: Record<string, unknown>): ParseResult {
  if (typeof body.participantId !== 'string') return { ok: false, reason: 'bad_message' }
  if (!isParticipantId(body.participantId)) return { ok: false, reason: 'unknown_participant' }
  return { ok: true, message: { type: 'join', participantId: body.participantId } }
}

function isParticipantId(value: string): value is ParticipantId {
  return participantById(value) !== null
}

function parseCreate(body: Record<string, unknown>): ParseResult {
  if (
    typeof body.startingPrice !== 'number' ||
    typeof body.minStep !== 'number' ||
    typeof body.durationMinutes !== 'number'
  ) {
    return { ok: false, reason: 'bad_message' }
  }
  return {
    ok: true,
    message: {
      type: 'create',
      startingPrice: body.startingPrice,
      minStep: body.minStep,
      durationMinutes: body.durationMinutes,
    },
  }
}
