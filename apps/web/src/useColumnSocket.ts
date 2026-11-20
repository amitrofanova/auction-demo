import type { ParticipantId } from '@auction/domain'
import { onMounted, onUnmounted, ref } from 'vue'

export type SocketStatus = 'connecting' | 'open' | 'closed'

const RETRY_MS = 800

export function useColumnSocket(participantId: ParticipantId, onMessage: (text: string) => void) {
  const status = ref<SocketStatus>('connecting')
  let socket: WebSocket | null = null
  let generation = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let opened = false

  function send(text: string) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(text)
  }

  function connect() {
    const gen = ++generation
    if (retry) {
      clearTimeout(retry)
      retry = undefined
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const current = new WebSocket(`${protocol}//${window.location.host}/ws?participant=${participantId}`)
    socket = current
    if (!opened) status.value = 'connecting'
    current.addEventListener('open', () => {
      if (gen !== generation) return
      opened = true
      status.value = 'open'
    })
    current.addEventListener('message', (event) => {
      if (gen !== generation) return
      onMessage(String(event.data))
    })
    current.addEventListener('close', () => {
      if (gen !== generation) return
      status.value = 'closed'
      socket = null
      if (stopped) return
      retry = setTimeout(connect, RETRY_MS)
    })
  }

  onMounted(connect)

  onUnmounted(() => {
    stopped = true
    generation += 1
    if (retry) clearTimeout(retry)
    const current = socket
    socket = null
    current?.close()
  })

  return { status, send }
}
