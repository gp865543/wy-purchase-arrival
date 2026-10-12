<script setup lang="ts">
// 单采购订单下的物料列表。对应客供收货的 receipt-prototype/List.vue 的 "order 已经选定" 分支。
// 顶部展示订单头（采购订单号 / 供应商 / 业务员 / 部门 / 采购日期 / state），
// 列表展示 details：物料名 + 规格 + 需求/累计已收/剩余 + 进度条。
// 点物料去 "/orders/:order/materials/:material/receipt" 走 Receipt 收货登记页。

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { Button, Empty, Loading } from 'tdesign-mobile-vue';

import {
  getPurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderDetailRow,
} from '../../api';
import Shell from './Shell.vue';

const route = useRoute();
const poId = computed(() => Number(route.params.order));

const order = ref<PurchaseOrder>();
const details = ref<PurchaseOrderDetailRow[]>([]);
const keyword = ref('');
const loading = ref(false);
const error = ref('');
let controller: AbortController | undefined;

async function load() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  error.value = '';
  order.value = undefined;
  details.value = [];
  try {
    const result = await getPurchaseOrder(poId.value, request.signal);
    if (request.signal.aborted) return;
    order.value = result.order;
    details.value = result.details;
  } catch (cause) {
    if (!request.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '订单明细读取失败，请重试';
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}
watch(
  () => poId.value,
  () => void load(),
  { immediate: true },
);
onUnmounted(() => controller?.abort());

const filteredDetails = computed(() =>
  details.value.filter((d) =>
    `${d.inventoryName}${d.inventoryCode}${d.spec}`
      .toLowerCase()
      .includes(keyword.value.trim().toLowerCase()),
  ),
);

function stateLabel(row: PurchaseOrder): string {
  if (row.state === 0) return '未审核';
  if (row.state === 1) return '已审核';
  if (row.state === 2) return '已关闭';
  return '';
}
function formatDate(date: string): string {
  return date ? date.slice(0, 10) : '';
}
</script>

<template>
  <Shell title="采购订单物料" back="/orders">
    <main class="pda-content plan-content plan-list" :aria-busy="loading">
      <section v-if="order" class="pda-card">
        <h2>{{ order.orderNo }}</h2>
        <p>{{ order.vendorName || '—' }}</p>
        <p class="muted">
          业务员 {{ order.personCode || '—' }} ·
          {{ stateLabel(order) }} · 部门 {{ order.departmentName || '—' }}
        </p>
        <p class="muted">制单日期 {{ formatDate(order.orderDate) }}</p>
        <p v-if="order.memo" class="muted">备注 {{ order.memo }}</p>
      </section>

      <t-search
        v-model="keyword"
        :maxlength="128"
        placeholder="搜索物料名称、编码或规格"
      />

      <section v-if="error" class="pda-card center" role="alert">
        <p>{{ error }}</p>
        <t-button theme="primary" @click="load">重试</t-button>
      </section>

      <div
        v-if="loading && details.length === 0"
        class="pda-card center"
        role="status"
      >
        <Loading :loading="loading" :delay="300" text="加载中…" />
      </div>

      <RouterLink
        v-for="m in filteredDetails"
        :key="m.rowId"
        :to="`/orders/${order!.poId}/materials/${m.rowId}/receipt`"
        class="pda-card receipt-link"
        :class="{ received: (m.receivedQuantity ?? 0) >= m.quantity }"
      >
        <div class="heading">
          <h2>{{ m.inventoryName }}</h2>
          <t-tag
            :theme="(m.receivedQuantity ?? 0) >= m.quantity ? 'success' : 'default'"
            variant="light"
          >
            {{
              (m.receivedQuantity ?? 0) >= m.quantity
                ? '收货完成'
                : (m.receivedQuantity ?? 0) > 0
                  ? '收货中'
                  : '待收货'
            }}
          </t-tag>
        </div>
        <p>{{ m.spec || '—' }}</p>
        <p v-if="m.inventoryCode" class="muted">{{ m.inventoryCode }}</p>
        <div class="receipt-stats">
          <span>
            需求<strong>{{ m.quantity }} {{ m.unitName ?? '—' }}</strong>
          </span>
          <span>
            累计已收<strong>{{ m.receivedQuantity ?? 0 }} {{ m.unitName ?? '—' }}</strong>
          </span>
          <span>
            剩余<strong>{{ m.quantity - (m.receivedQuantity ?? 0) }} {{ m.unitName ?? '—' }}</strong>
          </span>
        </div>
        <t-progress
          :percentage="
            Math.min(100, ((m.receivedQuantity ?? 0) / Math.max(1, m.quantity)) * 100)
          "
          :label="false"
        />
      </RouterLink>

      <t-empty
        v-if="!loading && !error && filteredDetails.length === 0"
        description="未找到物料，请调整关键词"
      />
    </main>
  </Shell>
</template>

<style scoped>
.pda-card.received {
  background: var(--td-success-color-light);
}
</style>
