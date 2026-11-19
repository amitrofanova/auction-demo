import type { ParticipantId } from '@auction/domain'
import { onMounted, onUnmounted, ref } from 'vue'

export type SocketStatus = 'connecting' | 'open' | 'closed'

export function useColumnSocket(participantId: ParticipantId, onMessage: (text: string) => void) {
  const status = ref<SocketStatus>('connecting')
  let socket: WebSocket | null = null

  function send(text: string) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(text)
  }

  onMounted(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const current = new WebSocket(`${protocol}//${window.location.host}/ws?participant=${participantId}`)
    socket = current
    current.addEventListener('open', () => {
      if (socket !== current) return
      status.value = 'open'
    })
    current.addEventListener('message', (event) => {
      if (socket !== current) return
      onMessage(String(event.data))
    })
    current.addEventListener('close', () => {
      if (socket !== current) return
      status.value = 'closed'
    })
  })

  onUnmounted(() => {
    const current = socket
    socket = null
    current?.close()
  })

  return { status, send }
}
