<script setup lang="ts">
import {
  STAGE_LABEL,
  participantById,
  suggestedAmount,
  type ClientMessage,
  type Participant,
} from '@auction/domain'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatClock, formatRemaining, formatRubles } from './format'
import { readIncoming } from './readSnapshot'
import { reasonText } from './reasonText'
import { useColumnSocket } from './useColumnSocket'

const props = defineProps<{
  participant: Participant
}>()

const snapshot = ref<Extract<ReturnType<typeof readIncoming>, { kind: 'snapshot' }>['snapshot'] | null>(null)
const sellerError = ref('')
const bidError = ref('')
const sending = ref(false)
const startInput = ref('10000')
const stepInput = ref('1000')
const durationInput = ref('2')
const amountInput = ref('')
const tick = ref(Date.now())
const clockOffset = ref(0)
const isSeller = computed(() => props.participant.id === 's')
const expectedRole = isSeller.value ? 'seller' : 'buyer'
let clockTimer: ReturnType<typeof setInterval> | undefined

const { status, send } = useColumnSocket(props.participant.id, (text) => {
  const next = readIncoming(text)
  if (!next) return
  if (next.kind === 'rejected') {
    if (next.command === 'place_bid') {
      sending.value = false
      bidError.value = reasonText(next.reason, 'place_bid')
      return
    }
    if (isSeller.value) sellerError.value = reasonText(next.reason, next.command)
    return
  }
  if (next.snapshot.role !== expectedRole) return
  if (snapshot.value?.stage !== next.snapshot.stage) sellerError.value = ''
  if (sending.value) bidError.value = ''
  sending.value = false
  clockOffset.value = next.snapshot.serverNow - Date.now()
  snapshot.value = next.snapshot
})

watch(status, (value) => {
  if (value !== 'open') return
  const join: ClientMessage = { type: 'join', participantId: props.participant.id }
  send(JSON.stringify(join))
})

onMounted(() => {
  clockTimer = setInterval(() => {
    tick.value = Date.now()
  }, 250)
})

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const statusText = computed(() => {
  if (status.value === 'open') return 'подключено'
  if (status.value === 'connecting') return 'соединение…'
  return 'нет соединения'
})

const onlineNames = computed(() => {
  if (!snapshot.value) return ''
  return snapshot.value.onlineParticipantIds.map((id) => participantById(id)?.name ?? id).join(', ')
})

const termsText = computed(() => {
  const terms = snapshot.value?.terms
  if (!terms) return ''
  return `Старт ${formatRubles(terms.startingPrice)} · шаг ${formatRubles(terms.minStep)} · ${terms.durationMinutes} мин`
})

const trading = computed(() => snapshot.value?.stage === 'live' || snapshot.value?.stage === 'closed')
const sellerSnapshot = computed(() => (snapshot.value?.role === 'seller' ? snapshot.value : null))
const buyerSnapshot = computed(() => (snapshot.value?.role === 'buyer' ? snapshot.value : null))

const suggested = computed(() => {
  const current = snapshot.value
  if (!current?.terms || current.stage !== 'live') return null
  return suggestedAmount(current.terms, current.amount)
})

watch(suggested, (value) => {
  if (value !== null) amountInput.value = String(value)
})

const amountLabel = computed(() => (snapshot.value?.amount == null ? '—' : formatRubles(snapshot.value.amount)))

const timerText = computed(() => {
  const current = snapshot.value
  if (!current || current.stage === 'closed') return current?.stage === 'closed' ? 'закрыт' : '—'
  if (current.stage !== 'live' || current.endsAt === null) return '—'
  return formatRemaining(current.endsAt - (tick.value + clockOffset.value))
})

const socketOpen = computed(() => status.value === 'open')

function sendCommand(message: ClientMessage) {
  sellerError.value = ''
  send(JSON.stringify(message))
}

function createAuction() {
  sendCommand({
    type: 'create',
    startingPrice: Number(startInput.value),
    minStep: Number(stepInput.value),
    durationMinutes: Number(durationInput.value),
  })
}

function launchAuction() {
  sendCommand({ type: 'launch' })
}

function finishAuction() {
  sendCommand({ type: 'finish' })
}

function restartAuction() {
  sendCommand({ type: 'restart' })
}

function placeBid() {
  if (sending.value || !socketOpen.value) return
  bidError.value = ''
  sending.value = true
  const message: ClientMessage = { type: 'place_bid', amount: Number(amountInput.value) }
  send(JSON.stringify(message))
}
</script>

<template>
  <section class="column" :data-testid="`column-${participant.id}`">
    <header class="column-head">
      <p class="eyebrow">{{ participant.role }}</p>
      <h2 class="column-name">{{ participant.name }}</h2>
    </header>

    <p class="status" :data-status="status">
      Соединение:
      <strong data-testid="connection">{{ statusText }}</strong>
      <span v-if="status === 'open' && snapshot" data-testid="online-count">
        · онлайн {{ snapshot.onlineParticipantIds.length }} ({{ onlineNames }})
      </span>
    </p>

    <article v-if="snapshot" class="lot-card" data-testid="lot-card">
      <img src="/vase.svg" alt="Декоративная ваза" width="80" height="80" />
      <div>
        <p class="eyebrow">Лот</p>
        <h2 class="lot-title" data-testid="lot-title">Демо-лот</h2>
        <p v-if="termsText" class="lot-note" data-testid="lot-terms">{{ termsText }}</p>
        <p class="pill" data-testid="stage" :data-stage="snapshot.stage">{{ STAGE_LABEL[snapshot.stage] }}</p>
      </div>
    </article>

    <section v-if="snapshot && trading" class="board" data-testid="board">
      <div v-if="sellerSnapshot">
        <span>Лидер</span>
        <strong data-testid="leader-name" :class="{ winner: sellerSnapshot.leader }">
          {{ sellerSnapshot.leader?.name ?? '—' }}
        </strong>
      </div>
      <div>
        <span>Сумма</span>
        <strong data-testid="leader-amount" :data-amount="snapshot.amount ?? ''">{{ amountLabel }}</strong>
      </div>
      <div>
        <span>Шаг</span>
        <strong data-testid="min-step">{{ snapshot.terms ? formatRubles(snapshot.terms.minStep) : '—' }}</strong>
      </div>
      <div>
        <span>До конца</span>
        <strong data-testid="timer" :data-ends-at="snapshot.endsAt ?? ''">{{ timerText }}</strong>
      </div>
    </section>

    <p v-if="!isSeller && snapshot?.stage === 'absent'" class="wait" data-testid="lot-wait">
      Продавец ещё не создал аукцион.
    </p>
    <p v-else-if="!isSeller && snapshot?.stage === 'awaiting'" class="wait" data-testid="lot-wait">
      Аукцион создан и ждёт запуска.
    </p>

    <section v-if="buyerSnapshot && snapshot?.stage === 'live'" class="panel">
      <h2 class="panel-title">Ставка</h2>
      <form @submit.prevent="placeBid">
        <label>
          Сумма, ₽
          <input v-model="amountInput" data-testid="bid-amount" inputmode="numeric" autocomplete="off" />
        </label>
        <div class="actions">
          <button class="primary" type="submit" data-testid="bid-submit" :disabled="!socketOpen || sending">
            {{ sending ? 'Отправляем' : 'Поставить' }}
          </button>
        </div>
      </form>
      <p v-if="suggested !== null" class="hint">От {{ formatRubles(suggested) }}, только сумма кратная шагу.</p>
      <p v-if="bidError" class="error" data-testid="bid-error">{{ bidError }}</p>
    </section>

    <p
      v-if="buyerSnapshot && snapshot?.stage === 'closed' && buyerSnapshot.youLead"
      class="win"
      data-testid="winner-message"
    >
      Вы победили. Итог {{ amountLabel }}.
    </p>
    <p v-else-if="buyerSnapshot && snapshot?.stage === 'closed'" class="wait" data-testid="lot-wait">
      Торги завершены.
    </p>

    <section v-if="isSeller && snapshot?.stage === 'absent'" class="panel">
      <h2 class="panel-title">Новый аукцион</h2>
      <p class="hint">Ставка не меньше шага и только кратная ему.</p>
      <form @submit.prevent="createAuction">
        <label>
          Начальная стоимость, ₽
          <input v-model="startInput" data-testid="start-price" inputmode="numeric" autocomplete="off" />
        </label>
        <label>
          Шаг, ₽
          <input v-model="stepInput" data-testid="bid-step" inputmode="numeric" autocomplete="off" />
        </label>
        <label>
          Длительность, мин
          <input v-model="durationInput" data-testid="duration-minutes" inputmode="numeric" autocomplete="off" />
        </label>
        <div class="actions">
          <button class="primary" type="submit" data-testid="create-auction" :disabled="!socketOpen">
            Создать аукцион
          </button>
        </div>
      </form>
      <p v-if="sellerError" class="error" data-testid="seller-error">{{ sellerError }}</p>
    </section>

    <section v-else-if="isSeller && snapshot?.stage === 'awaiting'" class="panel">
      <h2 class="panel-title">Условия сохранены</h2>
      <div class="actions">
        <button
          class="primary"
          type="button"
          data-testid="launch-auction"
          :disabled="!socketOpen"
          @click="launchAuction"
        >
          Запустить
        </button>
      </div>
      <p v-if="sellerError" class="error" data-testid="seller-error">{{ sellerError }}</p>
    </section>

    <section v-else-if="isSeller && trading" class="panel">
      <div class="actions">
        <button
          v-if="snapshot?.stage === 'live'"
          class="primary"
          type="button"
          data-testid="finish-auction"
          :disabled="!socketOpen"
          @click="finishAuction"
        >
          Завершить
        </button>
        <button
          class="ghost"
          type="button"
          data-testid="restart-auction"
          :disabled="!socketOpen"
          @click="restartAuction"
        >
          Перезапустить
        </button>
      </div>
      <p v-if="sellerError" class="error" data-testid="seller-error">{{ sellerError }}</p>
    </section>

    <section v-if="sellerSnapshot && trading" class="panel" data-testid="bid-feed">
      <h2 class="panel-title">Лента ставок</h2>
      <p class="counters" data-testid="bid-count">Ставок: {{ sellerSnapshot.bids.length }}</p>
      <p v-if="sellerSnapshot.bids.length === 0" class="hint">Ставок пока нет</p>
      <ol v-else class="feed" data-testid="bid-list">
        <li v-for="bid in sellerSnapshot.bids" :key="bid.seq">
          <span class="seq">#{{ bid.seq }}</span>
          <span class="name">{{ bid.name }}</span>
          <span class="sum">{{ formatRubles(bid.amount) }}</span>
          <span class="source">{{ bid.source === 'autobroker' ? 'авто' : 'вручную' }}</span>
          <time>{{ formatClock(bid.at) }}</time>
        </li>
      </ol>
    </section>
  </section>
</template>
