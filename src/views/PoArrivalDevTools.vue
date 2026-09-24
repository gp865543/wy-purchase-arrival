<script setup lang="ts">
import { ref } from 'vue';
import ToolsIcon from 'tdesign-icons-vue-next/esm/components/tools';
import { Button } from 'tdesign-mobile-vue';
const emit = defineEmits<{ simulate: [] }>();
defineProps<{ disabled?: boolean }>();
const menu = ref(false);
function simulate() { menu.value = false; emit('simulate'); }
</script>
<template>
  <div class="dev-tools"><div v-if="menu" class="dev-menu"><Button theme="light" size="small" block :disabled="disabled" @click="simulate">模拟打印</Button></div><Button class="dev-button" variant="text" aria-label="开发工具" :aria-expanded="menu" @click="menu = !menu"><ToolsIcon size="20px" aria-hidden="true" /></Button></div>
</template>
<style scoped>
/* 悬浮在底部操作栏之上，半透明，不抢业务内容。 */
.dev-tools { position: absolute; right: var(--td-spacer-2); bottom: calc(100% + var(--td-spacer-2)); z-index: 100; display: flex; flex-direction: column; align-items: flex-end; gap: var(--td-spacer-1); }
.dev-menu { box-shadow: var(--td-shadow-2); border-radius: var(--td-radius-default); }
.dev-button { width: 36px; height: 36px; min-height: 0; padding: 0; color: var(--td-text-color-secondary); background: var(--td-bg-color-container); border: 1px solid var(--td-component-border); border-radius: var(--td-radius-circle); opacity: .55; }
.dev-button[aria-expanded='true'], .dev-button:active { opacity: 1; }
</style>
