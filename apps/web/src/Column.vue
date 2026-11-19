<script setup lang="ts">
import type { Participant } from '@auction/domain'
import { computed } from 'vue'
import { useColumnSocket } from './useColumnSocket'

const props = defineProps<{
  participant: Participant
}>()

const { status } = useColumnSocket(props.participant.id)

const statusText = computed(() => {
  if (status.value === 'open') return 'подключено'
  if (status.value === 'connecting') return 'соединение…'
  return 'нет соединения'
})
</script>

<template>
  <section class="column">
    <p class="role">{{ participant.role }}</p>
    <h2>{{ participant.name }}</h2>
    <p class="status" :class="status">Соединение: {{ statusText }}</p>
  </section>
</template>
