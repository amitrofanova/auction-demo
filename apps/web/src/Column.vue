<script setup lang="ts">
import { STAGE_LABEL, participantById, type ClientMessage, type Participant } from '@auction/domain'
import { computed, ref, watch } from 'vue'
import { formatRubles } from './format'
import { readIncoming } from './readSnapshot'
import { reasonText } from './reasonText'
import { useColumnSocket } from './useColumnSocket'

const props = defineProps<{
  participant: Participant
}>()

const snapshot = ref<Extract<ReturnType<typeof readIncoming>, { kind: 'snapshot' }>['snapshot'] | null>(null)
const sellerError = ref('')
const startInput = ref('10000')
const stepInput = ref('1000')
const durationInput = ref('2')
const isSeller = computed(() => props.participant.id === 's')
const expectedRole = isSeller.value ? 'seller' : 'buyer'

const { status, send } = useColumnSocket(props.participant.id, (text) => {
  const next = readIncoming(text)
  if (!next) return
  if (next.kind === 'rejected') {
    if (isSeller.value) sellerError.value = reasonText(next.reason)
    return
  }
  if (next.snapshot.role !== expectedRole) return
  if (snapshot.value?.stage !== next.snapshot.stage) sellerError.value = ''
  snapshot.value = next.snapshot
})

watch(status, (value) => {
  if (value !== 'open') return
  const join: ClientMessage = { type: 'join', participantId: props.participant.id }
  send(JSON.stringify(join))
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

    <p v-if="!isSeller && snapshot?.stage === 'absent'" class="wait" data-testid="lot-wait">
      Продавец ещё не создал аукцион.
    </p>
    <p v-else-if="!isSeller && snapshot?.stage === 'awaiting'" class="wait" data-testid="lot-wait">
      Аукцион создан и ждёт запуска.
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

    <section v-else-if="isSeller && (snapshot?.stage === 'live' || snapshot?.stage === 'closed')" class="panel">
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
  </section>
</template>
