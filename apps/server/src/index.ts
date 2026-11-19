import type { IncomingMessage } from 'node:http'
import { participantById } from '@auction/shared'
import { WebSocketServer } from 'ws'

const port = Number(process.env.WS_PORT ?? 8787)
const host = '127.0.0.1'
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
})

server.on('listening', () => {
  console.log(`websocket слушает ws://${host}:${port}`)
})

function readParticipantId(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? '/', `http://${host}`)
  return url.searchParams.get('participant')
}
