<script setup lang="ts">
import { STAGE_LABEL, participantById, type ClientMessage, type Participant } from '@auction/domain'
import { computed, ref, watch } from 'vue'
import { formatRubles } from './format'
import { readSnapshot } from './readSnapshot'
import { useColumnSocket } from './useColumnSocket'

const props = defineProps<{
  participant: Participant
}>()

const snapshot = ref<ReturnType<typeof readSnapshot>>(null)
const expectedRole = props.participant.id === 's' ? 'seller' : 'buyer'

const { status, send } = useColumnSocket(props.participant.id, (text) => {
  const next = readSnapshot(text)
  if (!next || next.role !== expectedRole) return
  snapshot.value = next
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

    <p v-if="snapshot?.stage === 'absent'" class="wait" data-testid="lot-wait">
      Продавец ещё не создал аукцион.
    </p>
    <p v-else-if="snapshot?.stage === 'awaiting'" class="wait" data-testid="lot-wait">
      Аукцион создан и ждёт запуска.
    </p>
  </section>
</template>
