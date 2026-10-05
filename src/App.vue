<script setup lang="ts">
// PDA 首页集成：根据 URL path 路由到不同页面。
//   - /apps/purchase-arrival/             → 采购到货清单（默认）
//   - /apps/purchase-arrival/putaway      → 采购入库扫码（仓库员现场扫码收货标签落地货架）
import { computed } from 'vue';
import PurchaseOrderList from './views/PurchaseOrderList.vue';
import StoragePutaway from './views/StoragePutaway.vue';

const props = defineProps<{
  pathname?: string;
}>();

// 取 /apps/purchase-arrival/ 后面的 path（去掉尾部斜杠）。
const activePage = computed(() => {
  const p = (props.pathname ?? '').replace(/^\/?apps\/purchase-arrival\/?/, '').replace(/\/$/, '');
  return p;
});
</script>

<template>
  <StoragePutaway v-if="activePage === 'putaway'" />
  <PurchaseOrderList v-else />
</template>