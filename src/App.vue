<script setup lang="ts">
// 路由入口：
//   - /apps/purchase-arrival/putaway  → StoragePutaway.vue（仓库入库扫码）
//   - 其余路径                       → RouterView（List / Order / Receipt / Preview）
// 切换逻辑保留 pathname 切片是因为 StoragePutaway 是独立的状态机页面，
// 与订单/物料链路无关；其它一律走 vue-router。

import { computed } from 'vue';
import { RouterView } from 'vue-router';
import StoragePutaway from './views/StoragePutaway.vue';

const isPutaway = computed(() => {
  const path = window.location.pathname.split('?')[0] || '';
  return path.replace(/\/$/, '').endsWith('/apps/purchase-arrival/putaway')
    || path.endsWith('/apps/purchase-arrival/putaway');
});
</script>

<template>
  <StoragePutaway v-if="isPutaway" />
  <RouterView v-else :key="$route.path" />
</template>
