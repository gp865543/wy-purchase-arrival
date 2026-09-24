<script setup lang="ts">
// 骨架：克隆 wy-material-print/src/views/PlanList.vue 的工程结构（滚动自动加载 / 防抖 /
// AbortController / requestId / 安全区 / dvh / 离门户 / 错误重载 / 关键词 URL 同步）。
// 业务字段：U8 已审核采购订单（state=1），顶部汇总"已审核 PO 数"代替"待备料数"。
// 完整实现等 wy-fastapi/portal_identity/purchase_arrival.py 落地后接通；当前骨架只展示
// 空态和标题，路由切换到详情页的契约预留好。
//
// Issue #2 完成（2026-09-24）：后端 purchase_arrival.py 已落地 + 8 项测试通过，
// api.ts 切换为真实 GET 调用，移除 .catch 占位。

import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Button, Empty, Loading, Navbar, Search, Tag } from 'tdesign-mobile-vue';
import { listPurchaseOrders, getSummary, type PurchaseOrder } from '../api';
import { leaveToPortal } from '../portal';
import PurchaseOrderDetail from './PurchaseOrderDetail.vue';

const activeOrder = ref<PurchaseOrder>();

const keyword = ref(new URLSearchParams(location.search).get('keyword') || '');
const items = ref<PurchaseOrder[]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const error = ref('');
const reviewedCount = ref<number>();
const scroll = ref<HTMLElement>();
let planController: AbortController | undefined;
let summaryController: AbortController | undefined;
let planRequestId = 0;
let summaryRequestId = 0;
let timer: ReturnType<typeof setTimeout>;

function loadMore() {
  const body = scroll.value;
  if (!body || activeOrder.value || loading.value || error.value || items.value.length >= total.value) return;
  if (body.scrollHeight - body.scrollTop - body.clientHeight < 160) void loadPlans();
}

function resetList() {
  items.value = [];
  total.value = 0;
  page.value = 0;
  error.value = '';
  scroll.value?.scrollTo(0, 0);
}

async function loadPlans(reset = false) {
  planController?.abort();
  const request = new AbortController();
  const requestId = ++planRequestId;
  planController = request;
  if (reset) resetList();
  loading.value = true;
  error.value = '';
  try {
    const result = await listPurchaseOrders(keyword.value.trim(), page.value + 1, request.signal);
    if (request.signal.aborted || requestId !== planRequestId) return;
    items.value = reset ? result.items : [...items.value, ...result.items];
    total.value = result.total;
    page.value = result.page;
  } catch (cause) {
    if (!request.signal.aborted && requestId === planRequestId) error.value = cause instanceof Error ? cause.message : '采购订单读取失败，请重试';
  } finally {
    if (!request.signal.aborted && requestId === planRequestId) {
      loading.value = false;
      await nextTick();
      if (!request.signal.aborted && requestId === planRequestId) loadMore();
    }
  }
}

async function loadSummary() {
  summaryController?.abort();
  const request = new AbortController();
  const requestId = ++summaryRequestId;
  summaryController = request;
  try {
    const result = await getSummary(request.signal);
    if (!request.signal.aborted && requestId === summaryRequestId) reviewedCount.value = result.reviewedCount;
  } catch {
    // Keep a previous successful count; an initial failure leaves the title without a number.
  }
}

function refresh() {
  void loadPlans(true);
  void loadSummary();
}

watch(keyword, () => {
  planController?.abort();
  clearTimeout(timer);
  resetList();
  loading.value = true;
  const url = new URL(location.href);
  if (keyword.value) url.searchParams.set('keyword', keyword.value);
  else url.searchParams.delete('keyword');
  history.replaceState(null, '', url);
  timer = setTimeout(() => { void loadPlans(); }, 250);
});
onMounted(refresh);
onUnmounted(() => { planController?.abort(); summaryController?.abort(); clearTimeout(timer); });

function backFromDetail() {
  activeOrder.value = undefined;
  refresh();
}

function orderLabel(order: PurchaseOrder) {
  return `查看 ${order.orderNo}，供应商：${order.vendorName || '未填写'}，部门：${order.departmentName || '未填写'}`;
}
</script>

<template>
  <PurchaseOrderDetail v-if="activeOrder" :key="activeOrder.poId" :order="activeOrder" @back="backFromDetail" />
  <div v-show="!activeOrder" class="order-screen">
    <Navbar
      :title="reviewedCount === undefined ? '采购到货清单' : `采购到货清单（已审核 ${reviewedCount} 个）`"
      :fixed="false"
      left-arrow
      @left-click="leaveToPortal"
    />
    <div class="search-panel">
      <Search v-model="keyword" placeholder="搜索订单号或供应商" :clearable="true" />
    </div>
    <main ref="scroll" class="order-body" :aria-busy="loading" @scroll.passive="loadMore">
      <template v-if="items.length">
        <article
          v-for="order in items"
          :key="order.poId"
          class="order-item"
          role="button"
          tabindex="0"
          :aria-label="orderLabel(order)"
          @click="activeOrder = order"
          @keydown.enter="activeOrder = order"
          @keydown.space.prevent="activeOrder = order"
        >
          <div class="item-heading">
            <div class="order-identity">
              <strong>{{ order.orderNo }}</strong>
              <Tag variant="light" theme="success">已审核</Tag>
            </div>
            <Tag variant="light" theme="primary">U8</Tag>
          </div>
          <dl class="properties">
            <dt>供应商</dt><dd>{{ order.vendorName || '未填写' }}（{{ order.vendorCode }}）</dd>
            <dt>部门</dt><dd>{{ order.departmentName || '未填写' }}</dd>
            <dt>订单日期</dt><dd>{{ order.orderDate || '未填写' }}</dd>
          </dl>
        </article>
      </template>
      <div v-if="error" class="center-state" role="alert">
        <Empty :description="error" />
        <Button theme="primary" @click="loadPlans()">重新加载</Button>
      </div>
      <div v-else-if="loading" class="center-state" role="status">
        <Loading text="正在加载采购订单" />
      </div>
      <Empty v-else-if="!items.length" :description="keyword.trim() ? '未找到匹配的订单' : '暂无已审核采购订单'" />
      <p v-else-if="items.length >= total" class="list-end">已显示全部订单</p>
    </main>
  </div>
</template>

<style scoped>
.order-screen {
  max-width: 480px;
  height: 100vh;
  height: 100dvh;
  margin: auto;
  display: flex;
  flex-direction: column;
  color: var(--td-text-color-primary);
  font: var(--td-font-body-large);
  background: var(--td-bg-color-page);
}
.search-panel {
  padding: var(--td-spacer-2);
  background: var(--td-bg-color-container);
}
.order-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--td-spacer-2) var(--td-spacer-2) max(var(--td-spacer-3), env(safe-area-inset-bottom));
  overscroll-behavior: contain;
}
.order-item {
  padding: var(--td-spacer-2);
  margin-bottom: var(--td-spacer-2);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-large);
  background: var(--td-bg-color-container);
}
.item-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-spacer-1);
}
.order-identity {
  display: flex;
  align-items: center;
  gap: var(--td-spacer-1);
  min-width: 0;
}
.item-heading strong {
  font-size: var(--td-font-size-body-large);
  overflow-wrap: anywhere;
  min-width: 0;
}
.item-heading :deep(.t-tag) {
  flex-shrink: 0;
}
.properties {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--td-spacer-1) var(--td-spacer-2);
  margin: var(--td-spacer-2) 0 0;
  font-size: var(--td-font-size-body-medium);
}
.properties dt {
  color: var(--td-text-color-secondary);
}
.properties dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.center-state {
  display: grid;
  justify-items: center;
  gap: var(--td-spacer-3);
  padding: var(--td-spacer-4) 0;
}
.list-end {
  text-align: center;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}
</style>