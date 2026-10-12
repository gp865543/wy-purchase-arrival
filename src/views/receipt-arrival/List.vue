<script setup lang="ts">
// 与 wy-customer-material-receipt 的 receipt-prototype/List.vue 同构：
//   Shell 包裹 + Search + tabs（pending/done/all）+ RouterLink 卡片 + 错误重试
// 业务字段映射到采购订单（poId/orderNo/orderDate/vendorName/personCode）。

import { onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { Button, Empty, Loading } from 'tdesign-mobile-vue';

import {
  listPurchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderDetailRow,
} from '../../api';
import Shell from './Shell.vue';

const router = useRouter();

const keyword = ref('');
const filter = ref('pending'); // 仅 UI 用：pending/done/all — 采购订单后端暂不返回聚合，按 pending=all 等价处理
const loading = ref(false);
const error = ref('');
const items = ref<PurchaseOrder[]>([]);
const page = ref(0);
const total = ref(0);
// 用于过滤"收货完成"的轻量缓存（key=poId → 来自 Order 页面拉到的 receipts.length ≥ received Quantity）
const completeMap = ref<Record<number, boolean>>({});

let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

async function load(reset = true) {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  error.value = '';
  loading.value = true;
  if (reset) {
    items.value = [];
    page.value = 0;
    total.value = 0;
  }
  try {
    const result = await listPurchaseOrders(
      keyword.value.trim(),
      page.value + 1,
      request.signal,
    );
    if (request.signal.aborted) return;
    items.value.push(...result.items);
    page.value = result.page;
    total.value = result.total;
  } catch (cause) {
    if (!request.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '采购订单读取失败，请重试';
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}

watch(
  filter,
  () => {
    clearTimeout(timer);
    void load();
  },
  { immediate: true },
);
watch(keyword, () => {
  clearTimeout(timer);
  controller?.abort();
  timer = setTimeout(() => void load(), 250);
});
onUnmounted(() => {
  controller?.abort();
  clearTimeout(timer);
});

function stateLabel(row: PurchaseOrder): string {
  if (row.state === 0) return '未审核';
  if (row.state === 1) return '已审核';
  if (row.state === 2) return '已关闭';
  return '';
}
function formatDate(date: string): string {
  if (!date) return '';
  // U8 返回 "YYYY-MM-DD 00:00:00.000"，只截前 10 位
  return date.slice(0, 10);
}
</script>

<template>
  <Shell title="采购订单">
    <main class="pda-content plan-content plan-list" :aria-busy="loading">
      <t-search
        v-model="keyword"
        :maxlength="128"
        placeholder="搜索采购订单号、供应商或业务员"
      />
      <t-tabs v-model="filter" class="receipt-tabs">
        <t-tab-panel value="pending" label="待收货" />
        <t-tab-panel value="done" label="收货完成" />
        <t-tab-panel value="all" label="全部" />
      </t-tabs>

      <section v-if="error" class="pda-card center" role="alert">
        <p>{{ error }}</p>
        <t-button theme="primary" @click="load(page === 0)">重试</t-button>
      </section>

      <div
        v-if="loading && items.length === 0"
        class="pda-card center"
        role="status"
      >
        <Loading :loading="loading" :delay="300" text="加载中…" />
      </div>

      <RouterLink
        v-for="o in items"
        :key="o.poId"
        :to="`/orders/${o.poId}`"
        class="pda-card receipt-link"
        :class="{ received: completeMap[o.poId] }"
      >
        <div class="heading">
          <h2>{{ o.orderNo }}</h2>
          <t-tag theme="primary" variant="light">
            {{ stateLabel(o) }}
          </t-tag>
        </div>
        <h3>{{ o.vendorName || '—' }}</h3>
        <p class="muted">
          制单日期 {{ formatDate(o.orderDate) }} · {{ o.personCode || '—' }}
        </p>
        <p class="muted">{{ o.departmentName || '—' }}</p>
      </RouterLink>

      <t-button
        v-if="items.length < total && !error"
        block
        variant="outline"
        @click="load(false)"
      >
        加载更多（{{ items.length }}/{{ total }}）
      </t-button>

      <t-empty
        v-if="!loading && !error && items.length === 0"
        description="未找到采购订单，请调整关键词"
      />
    </main>
  </Shell>
</template>

<style scoped>
.pda-card.received {
  background: var(--td-success-color-light);
}
</style>
