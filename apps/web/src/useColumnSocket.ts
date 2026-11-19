import type { ParticipantId } from '@auction/domain'
import { onMounted, onUnmounted, ref } from 'vue'

export type SocketStatus = 'connecting' | 'open' | 'closed'

export function useColumnSocket(participantId: ParticipantId) {
  const status = ref<SocketStatus>('connecting')
  let socket: WebSocket | null = null

  onMounted(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(`${protocol}//${window.location.host}/ws?participant=${participantId}`)
    socket.addEventListener('open', () => {
      status.value = 'open'
    })
    socket.addEventListener('close', () => {
      status.value = 'closed'
    })
  })

  onUnmounted(() => {
    socket?.close()
    socket = null
  })

  return { status }
}
