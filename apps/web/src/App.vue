<script setup lang="ts">
import { PARTICIPANTS } from '@auction/domain'
import Column from './Column.vue'
</script>

<template>
  <main class="page">
    <header class="head">
      <div>
        <p class="eyebrow">Аукцион с шагом</p>
        <h1 class="gradient-text">Аукцион</h1>
      </div>
    </header>
    <div class="columns">
      <Column v-for="participant in PARTICIPANTS" :key="participant.id" :participant="participant" />
    </div>
  </main>
</template>
