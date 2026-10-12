<script setup lang="ts">
// 单物料收货登记页。对应客供收货的 receipt/Receipt.vue（保存 / 编辑 / 删除 / Preview 模态）。
//
// 业务流：
//   1. listOrderMaterials(poId) → 找出 rowId 对应 detail，展示历史 receipts
//   2. 表单录入"本次数量 / 可选计划号"
//   3. saveReceipt(poId, allocation) → 跳 /receipts/:id/preview
//   4. 单条 receipt 支持 updateReceipt / deleteReceipt
//
// Issue #2（2026-10-04）后端 purchase_arrival.py 已落地，可直接调用真实 API。

import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Button, Empty, Input, Loading } from 'tdesign-mobile-vue';

import {
  deleteReceipt,
  ensureOperatorName,
  getPurchaseOrder,
  getOperatorName,
  listOrderMaterials,
  saveReceipt,
  updateReceipt,
  type PurchaseOrder,
  type PurchaseOrderDetailRow,
  type Receipt,
} from '../../api';
import Shell from './Shell.vue';
import Preview from './Preview.vue';

const route = useRoute();
const router = useRouter();

const poId = computed(() => Number(route.params.order));
const rowId = computed(() => Number(route.params.material));

const order = ref<PurchaseOrder>();
const detail = ref<PurchaseOrderDetailRow>();
const loading = ref(false);
const error = ref('');

const quantity = ref('');
const planNumber = ref('');
const saving = ref(false);
const formError = ref('');

const editingId = ref('');
const editQuantity = ref('');
const editPlanNumber = ref('');
const editError = ref('');

const deleting = ref<Receipt>();
const deleteError = ref('');

// Preview 模态状态（与客供收货一致，作为 dialog 嵌入本页，不走独立路由）
const showPreview = ref(false);
const previewId = ref('');
function openPreview(id: string) { previewId.value = id; showPreview.value = true; }
function closePreview() { showPreview.value = false; previewId.value = ''; }

let controller: AbortController | undefined;

async function load() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  error.value = '';
  order.value = undefined;
  detail.value = undefined;
  try {
    // 用 listOrderMaterials 拿到 details，再从 order header 拿到订单头；
    // 这里仍用 getPurchaseOrder 一次性拿 {order,details}，避免两次 round-trip。
    const result = await getPurchaseOrder(poId.value, request.signal);
    if (request.signal.aborted) return;
    order.value = result.order;
    detail.value = result.details.find((d) => d.rowId === rowId.value);
  } catch (cause) {
    if (!request.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '订单明细读取失败，请重试';
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}
watch(
  () => [poId.value, rowId.value],
  () => void load(),
  { immediate: true },
);
onUnmounted(() => controller?.abort());

const records = computed<Receipt[]>(() => detail.value?.receipts ?? []);
const demand = computed(() => detail.value?.quantity ?? 0);
const received = computed(() => detail.value?.receivedQuantity ?? 0);
const remaining = computed(() => demand.value - received.value);
const unit = computed(() => detail.value?.unitName ?? '');

function formatTime(ts: string): string {
  return ts ? new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }) : '';
}

function validateQty(q: string): string {
  const trimmed = (q || '').trim();
  if (!trimmed) return '请输入大于零的收货数量';
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return '请输入有效数字';
  if (Number(trimmed) <= 0) return '数量须大于 0';
  if (trimmed.length > 12) return '数量过长';
  return '';
}

async function save() {
  const err = validateQty(quantity.value);
  if (err) {
    formError.value = err;
    return;
  }
  if (saving.value || !detail.value) return;
  saving.value = true;
  formError.value = '';
  try {
    const operator = getOperatorName() || (await ensureOperatorName()) || '操作员';
    void operator;
    await saveReceipt(poId.value, {
      rowId: detail.value.rowId,
      planNumber: planNumber.value.trim(),
      quantity: Number(quantity.value),
    });
    quantity.value = '';
    planNumber.value = '';
    await load();
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

function startEdit(record: Receipt) {
  editingId.value = record.id;
  editQuantity.value = String(record.quantity);
  editPlanNumber.value = record.planNumber || '';
  editError.value = '';
}

async function saveEdit() {
  if (saving.value || !editingId.value || !detail.value) return;
  const err = validateQty(editQuantity.value);
  if (err) {
    editError.value = err;
    return;
  }
  saving.value = true;
  editError.value = '';
  try {
    await updateReceipt(
      editingId.value,
      poId.value,
      detail.value.rowId,
      editPlanNumber.value.trim(),
      Number(editQuantity.value),
    );
    editingId.value = '';
    editQuantity.value = '';
    editPlanNumber.value = '';
    await load();
  } catch (cause) {
    editError.value = cause instanceof Error ? cause.message : '编辑失败，请重试';
  } finally {
    saving.value = false;
  }
}

function cancelEdit() {
  editingId.value = '';
  editQuantity.value = '';
  editPlanNumber.value = '';
  editError.value = '';
}

function confirmDelete(record: Receipt) {
  deleting.value = record;
  deleteError.value = '';
}

async function remove() {
  if (saving.value || !deleting.value) return;
  saving.value = true;
  deleteError.value = '';
  try {
    await deleteReceipt(deleting.value.id);
    if (editingId.value === deleting.value.id) cancelEdit();
    deleting.value = undefined;
    await load();
  } catch (cause) {
    deleteError.value = cause instanceof Error ? cause.message : '删除失败，请重试';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Shell title="采购物料收货" :back="`/orders/${order?.poId ?? ''}`">
    <main class="pda-content plan-content plan-list" :aria-busy="loading">
      <section v-if="order && detail" class="pda-card">
        <div class="heading">
          <h2>{{ order.orderNo }}</h2>
          <t-tag
            :theme="received >= demand ? 'success' : received > 0 ? 'warning' : 'default'"
            variant="light"
          >
            {{ received >= demand ? '收货完成' : received > 0 ? '收货中' : '待收货' }}
          </t-tag>
        </div>
        <p>{{ order.vendorName || '—' }}</p>
        <p class="muted">业务员 {{ order.personCode || '—' }} · 部门 {{ order.departmentName || '—' }}</p>
        <h3>{{ detail.inventoryName }}</h3>
        <p>{{ detail.spec || '—' }}</p>
        <p v-if="detail.inventoryCode" class="muted">{{ detail.inventoryCode }}</p>
        <div class="receipt-stats">
          <span>需求<strong>{{ demand }} {{ unit }}</strong></span>
          <span>累计已收<strong>{{ received }} {{ unit }}</strong></span>
          <span>剩余<strong>{{ remaining }} {{ unit }}</strong></span>
        </div>
      </section>

      <section v-if="error" class="pda-card center" role="alert">
        <p>{{ error }}</p>
        <t-button theme="primary" @click="load">重试</t-button>
      </section>

      <div v-if="loading && !detail" class="pda-card center" role="status">
        <Loading :loading="loading" :delay="300" text="加载中…" />
      </div>

      <section v-if="detail" class="pda-card">
        <h3>本次收货</h3>
        <t-input
          v-model="quantity"
          label="数量"
          :placeholder="`请输入收货数量 (${unit})`"
          type="number"
          align="right"
        />
        <t-input
          v-model="planNumber"
          label="计划号"
          placeholder="可选，供查询"
          align="right"
        />
        <p v-if="formError" class="error" role="alert">{{ formError }}</p>
        <t-button theme="primary" block :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '确定' }}
        </t-button>
      </section>

      <section v-if="records.length" class="pda-card">
        <div class="history-header">
          <h2>收货记录</h2>
          <span class="muted">{{ records.length }} 条</span>
        </div>
        <div v-for="r in records" :key="r.id" class="receipt-history-row">
          <div class="heading">
            <h3 class="qty">{{ r.quantity }} {{ unit }}</h3>
            <t-tag theme="warning" variant="light">待打印</t-tag>
          </div>
          <p class="muted">
            <span>操作员 {{ r.printedBy || '—' }} · {{ formatTime(r.createdAt) }}</span>
            <span v-if="r.planNumber" class="plan">计划号 {{ r.planNumber }}</span>
          </p>

          <template v-if="editingId === r.id">
            <t-input v-model="editQuantity" label="数量" type="number" align="right" />
            <t-input v-model="editPlanNumber" label="计划号" align="right" />
            <p v-if="editError" class="error" role="alert">{{ editError }}</p>
            <div class="receipt-actions">
              <t-button variant="outline" size="small" @click="cancelEdit">取消</t-button>
              <t-button theme="primary" size="small" :disabled="saving" @click="saveEdit">保存编辑</t-button>
            </div>
          </template>
          <template v-else>
            <div class="receipt-actions">
              <t-button variant="outline" size="small" @click="startEdit(r)">修改数量</t-button>
              <t-button variant="outline" size="small" @click="openPreview(r.id)">打印贴签</t-button>
              <t-button variant="outline" size="small" theme="danger" @click="confirmDelete(r)">删除</t-button>
            </div>
          </template>
        </div>

        <div v-if="deleting" class="receipt-history-row confirm">
          <p>确认删除 {{ deleting.quantity }} {{ unit }} @ {{ formatTime(deleting.createdAt) }} ？</p>
          <p v-if="deleteError" class="error" role="alert">{{ deleteError }}</p>
          <div class="receipt-actions">
            <t-button variant="outline" size="small" @click="deleting = undefined">取消</t-button>
            <t-button theme="danger" size="small" :disabled="saving" @click="remove">确认删除</t-button>
          </div>
        </div>
      </section>

      <t-empty v-if="!loading && !error && detail && records.length === 0" description="尚未收货" />
    </main>
    <Preview
      v-if="showPreview"
      :record-id="previewId"
      @close="closePreview"
    />
  </Shell>
</template>

<style scoped>
.pda-card.received {
  background: var(--td-success-color-light);
}
.history-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.history-header h2 {
  margin: 0;
  font-size: var(--td-font-size-title-medium);
  color: var(--td-text-color-primary);
}
.receipt-history-row {
  background: var(--td-warning-color-light);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  padding: 12px 14px;
  margin: 8px 0;
}
.receipt-history-row .heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.receipt-history-row .qty {
  margin: 0;
  font-size: var(--td-font-size-title-large);
  font-weight: 600;
  color: var(--td-text-color-primary);
}
.receipt-history-row .plan {
  margin-left: 8px;
}
.receipt-history-row.confirm {
  background: var(--td-error-color-light);
}
.receipt-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.receipt-actions > * {
  flex: 1;
  min-width: 0;
}
</style>
