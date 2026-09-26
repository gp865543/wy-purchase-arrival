<script setup lang="ts">
// 路由配置：支持多页面切换
import { onMounted, ref } from 'vue';
import LabelPreview from './views/LabelPreview.vue';
import PurchaseOrderList from './views/PurchaseOrderList.vue';
import StoragePutaway from './views/StoragePutaway.vue';

type Page = 'list' | 'label' | 'putaway';

const currentPage = ref<Page>('list');

function getPage(): Page {
  const params = new URLSearchParams(location.search);
  if (params.get('page') === 'putaway') return 'putaway';
  if (params.get('preview') === 'label') return 'label';
  return 'list';
}

// 监听 hash 变化（门户跳转）
window.addEventListener('hashchange', () => {
  currentPage.value = getPage();
});

onMounted(() => {
  currentPage.value = getPage();
});
</script>
<template>
  <StoragePutaway v-if="currentPage === 'putaway'" />
  <LabelPreview v-else-if="currentPage === 'label'" />
  <PurchaseOrderList v-else />
</template>