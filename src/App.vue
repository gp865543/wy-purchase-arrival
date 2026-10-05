<script setup lang="ts">
// PDA 首页集成：根据 URL ?page 参数路由到不同页面。
//   - 无 page：采购到货清单（默认）
//   - page=putaway：采购入库扫码（仓库员现场扫码收货标签落地货架）
import { computed } from 'vue';
import PurchaseOrderList from './views/PurchaseOrderList.vue';
import StoragePutaway from './views/StoragePutaway.vue';

const props = defineProps<{
  page?: string;
}>();

const activePage = computed(() => props.page ?? '');
</script>

<template>
  <StoragePutaway v-if="activePage === 'putaway'" />
  <PurchaseOrderList v-else />
</template>