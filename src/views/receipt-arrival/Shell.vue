<script setup lang="ts">
import { useRouter } from 'vue-router';
import './style.css';

withDefaults(
  defineProps<{ back?: string; title: string; showTools?: boolean }>(),
  { back: undefined, showTools: false },
);
const router = useRouter();
</script>

<template>
  <div class="template-page">
    <div class="pda-screen">
      <t-navbar
        :title="title"
        :fixed="false"
        :left-arrow="!!back"
        @left-click="back && router.push(back)"
      />
      <slot></slot>
    </div>
  </div>
</template>
