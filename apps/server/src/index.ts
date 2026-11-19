import type { IncomingMessage } from 'node:http'
import { participantById } from '@auction/domain'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { createRoom } from './room'

const port = Number(process.env.WS_PORT ?? 8787)
const host = '127.0.0.1'
const room = createRoom()
const server = new WebSocketServer({ port, host })

server.on('connection', (socket, request) => {
  const participant = participantById(readParticipantId(request) ?? '')
  if (!participant) {
    console.log('отклонено: неизвестный участник')
    socket.close()
    return
  }

  console.log(`подключено: ${participant.name}`)
  socket.on('close', () => {
    console.log(`отключено: ${participant.name}`)
  })

  room.connect({
    send(data) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data)
    },
    onMessage(listener) {
      socket.on('message', (data) => listener(textFrom(data)))
    },
    onClose(listener) {
      socket.on('close', () => listener())
    },
  })
})

server.on('listening', () => {
  console.log(`websocket слушает ws://${host}:${port}`)
})

function readParticipantId(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '/', `http://${host}`)
  return url.searchParams.get('participant')
}

function textFrom(data: RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString()
  if (Buffer.isBuffer(data)) return data.toString()
  return Buffer.from(data).toString()
}
