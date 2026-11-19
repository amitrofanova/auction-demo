import {
  apply,
  emptyAuction,
  parseClientMessage,
  participantById,
  project,
  toAuctionCommand,
  type ApplyResult,
  type AuctionState,
  type ClientCommand,
  type ParticipantId,
  type ServerMessage,
} from '@auction/domain'

export type RoomSocket = {
  send(data: string): void
  onMessage(listener: (text: string) => void): void
  onClose(listener: () => void): void
}

export type RoomClock = {
  now(): number
  schedule(delayMs: number, run: () => void): { cancel(): void }
}

type Connection = {
  socket: RoomSocket
  participantId: ParticipantId | null
}

const ORDER = ['a', 'b', 's'] as const

export function createRoom(clock: RoomClock = systemClock()) {
  let state: AuctionState = emptyAuction()
  let seq = 0
  let timer: { cancel(): void } | undefined
  const connections = new Set<Connection>()

  function connect(socket: RoomSocket) {
    const connection: Connection = { socket, participantId: null }
    connections.add(connection)
    socket.onMessage((text) => onText(connection, text))
    socket.onClose(() => {
      const joined = connection.participantId !== null
      connections.delete(connection)
      if (joined) broadcast()
    })
  }

  function onText(connection: Connection, text: string) {
    const parsed = parseClientMessage(text)
    if (!parsed.ok) {
      send(connection, { type: 'rejected', reason: parsed.reason })
      return
    }

    const message = parsed.message
    if (message.type === 'join') {
      join(connection, message.participantId)
      return
    }
    if (!connection.participantId) {
      send(connection, { type: 'rejected', reason: 'bad_message' })
      return
    }

    const command = toAuctionCommand(message, connection.participantId)
    commit(apply(state, command, clock.now()), connection, message)
  }

  function join(connection: Connection, participantId: ParticipantId) {
    if (connection.participantId === participantId) {
      send(connection, snapshotFor(connection, seq))
      return
    }
    if (connection.participantId) {
      send(connection, { type: 'rejected', reason: 'bad_message' })
      return
    }
    connection.participantId = participantId
    const name = participantById(participantId)?.name ?? participantId
    console.log(`в комнате: ${name}`)
    broadcast()
  }

  /** Снимок уходит всем. Отказ и потолок — только сокету, который прислал команду. */
  function commit(result: ApplyResult, connection: Connection | null, command: ClientCommand | null) {
    const changed = result.state !== state
    state = result.state
    if (changed) broadcast()
    armTimer()
    if (!connection || !command) return
    if (!result.ok) {
      const name = participantById(connection.participantId ?? '')?.name ?? connection.participantId
      console.log(`отказ: ${name} ${result.reason}`)
      send(connection, { type: 'rejected', reason: result.reason, command: command.type })
      return
    }
    if (command.type === 'set_autobroker' || command.type === 'remove_autobroker') {
      send(connection, { type: 'autobroker', maxAmount: ownCeiling(connection.participantId) })
    }
  }

  function broadcast() {
    seq += 1
    for (const connection of connections) {
      if (!connection.participantId) continue
      send(connection, snapshotFor(connection, seq))
    }
  }

  function snapshotFor(connection: Connection, atSeq: number): ServerMessage {
    if (!connection.participantId) throw new Error('snapshot for a socket without a participant')
    return project(state, connection.participantId, {
      seq: atSeq,
      serverNow: clock.now(),
      onlineParticipantIds: onlineIds(),
    })
  }

  function armTimer() {
    if (timer) {
      timer.cancel()
      timer = undefined
    }
    if (state.stage !== 'live') return
    const delay = Math.max(0, state.endsAt - clock.now())
    timer = clock.schedule(delay, () => {
      timer = undefined
      commit(apply(state, { type: 'close_if_due' }, clock.now()), null, null)
    })
  }

  function onlineIds(): ParticipantId[] {
    const present = new Set<ParticipantId>()
    for (const connection of connections) {
      if (connection.participantId) present.add(connection.participantId)
    }
    return ORDER.filter((id) => present.has(id))
  }

  function ownCeiling(participantId: ParticipantId | null): number | null {
    if (!participantId || participantId === 's') return null
    if (state.stage !== 'live' && state.stage !== 'closed') return null
    return state.autobrokers[participantId]?.maxAmount ?? null
  }

  function send(connection: Connection, message: ServerMessage) {
    connection.socket.send(JSON.stringify(message))
  }

  return { connect }
}

function systemClock(): RoomClock {
  return {
    now: () => Date.now(),
    schedule(delayMs, run) {
      const id = setTimeout(run, delayMs)
      return { cancel: () => clearTimeout(id) }
    },
  }
}
