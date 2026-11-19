<script setup lang="ts">
import { PARTICIPANTS } from '@auction/domain'
import Column from './Column.vue'
</script>

<template>
  <main>
    <h1>Аукцион</h1>
    <div class="columns">
      <Column
        v-for="participant in PARTICIPANTS"
        :key="participant.id"
        :participant="participant"
      />
    </div>
  </main>
</template>
