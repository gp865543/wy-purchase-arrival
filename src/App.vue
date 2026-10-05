<script setup lang="ts">
// PDA 首页集成：根据 URL path 路由到不同页面。
//   - /apps/purchase-arrival/             → 采购到货清单（默认）
//   - /apps/purchase-arrival/putaway...    → 采购入库（仓库员现场扫码收货标签落地货架）
import { computed } from 'vue';
import PurchaseOrderList from './views/PurchaseOrderList.vue';
import StoragePutaway from './views/StoragePutaway.vue';

const props = defineProps<{
  pathname?: string;
}>();

// 取 /apps/purchase-arrival/ 后面的 path 段（剥掉 query 与尾斜杠，避免 portal_entry 等
// 把 activePage 撑成 "putaway?portal_entry=/pda" 导致模板 fallthrough）。
const activePage = computed(() => {
  const pathOnly = (props.pathname ?? '').split('?')[0] ?? '';
  return pathOnly.replace(/^\/?apps\/purchase-arrival\/?/, '').replace(/\/$/, '');
});
</script>

<template>
  <StoragePutaway v-if="activePage.startsWith('putaway')" />
  <PurchaseOrderList v-else />
</template>
