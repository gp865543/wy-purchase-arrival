<script setup lang="ts">
// 骨架：克隆 wy-material-print/src/views/MaterialList.vue 的工程结构（顶部 Heading / 搜索 /
// 滚动内容 / 选中 / 全选 / 底部打印预览入口 / 返回栈 / 安全区）。业务字段：PO 明细物料。
// 当前骨架仅展示空态，完整实现等后端接通后补：

import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Button, Checkbox, Empty, Loading, Navbar, Search, Tag } from 'tdesign-mobile-vue';
import { getPurchaseOrder, getPrintCounts, type PurchaseOrder, type PurchaseOrderDetail } from '../api';
import PrintPreview from './PrintPreview.vue';
import PoArrivalDevTools from './PoArrivalDevTools.vue';
import { usePageBack } from '../pageBack';

const props = defineProps<{ order: PurchaseOrder }>();
const emit = defineEmits<{ back: [] }>();

const previewOpen = ref(false);
const printCopies = ref<Record<number, string>>({});
const devTools = import.meta.env.DEV ? PoArrivalDevTools : null;
const simulatePreview = ref(false);

const details = ref<PurchaseOrderDetail[]>([]);
const counts = ref<Record<number, number> | undefined>(undefined);
const countError = ref('');
const selected = ref<number[]>([]);
const keyword = ref('');
const loading = ref(true);
const error = ref('');
const submitting = ref(false);

let controller: AbortController | undefined;
let countRequest: AbortController | undefined;

const visibleItems = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase();
  if (!query) return details.value;
  return details.value.filter(item =>
    [item.inventoryName, item.spec, item.inventoryCode].some(value => value.toLowerCase().includes(query)),
  );
});

const allSelected = computed(() => visibleItems.value.length > 0 && visibleItems.value.every(item => selected.value.includes(item.rowId)));

function choose(rowId: number, checked: boolean) {
  if (submitting.value) return;
  selected.value = checked ? [...selected.value, rowId] : selected.value.filter(id => id !== rowId);
}
function all(checked: boolean) {
  if (submitting.value) return;
  const ids = new Set(visibleItems.value.map(item => item.rowId));
  selected.value = checked ? [...new Set([...selected.value, ...ids])] : selected.value.filter(id => !ids.has(id));
}
function toggleCopies(rowId: number, value: string) {
  printCopies.value[rowId] = value;
}

async function loadCounts() {
  countRequest?.abort();
  const request = new AbortController();
  countRequest = request;
  countError.value = '';
  try {
    const result = await getPrintCounts(props.order.poId, request.signal).catch(() => ({ counts: {} }));
    if (!request.signal.aborted) counts.value = result.counts;
  } catch (cause) {
    if (!request.signal.aborted) { counts.value = undefined; countError.value = cause instanceof Error ? cause.message : '打印次数读取失败，请重试'; }
  }
}

function preparePreview(simulate = false) {
  if (!selected.value.length) return;
  simulatePreview.value = simulate;
  previewOpen.value = true;
}

function closePreview() {
  previewOpen.value = false;
  void loadCounts();
}

const navigateBack = usePageBack('detail', () => emit('back'), () => !submitting.value);

async function back() {
  navigateBack();
}

async function load() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  error.value = '';
  details.value = [];
  selected.value = [];
  try {
    // 骨架：当前 api.ts 抛 TODO；try/catch 命中后展示空态。
    const result = await getPurchaseOrder(props.order.poId, request.signal).catch(() => ({ order: props.order, details: [] }));
    if (!request.signal.aborted) {
      details.value = result.details;
      details.value.forEach(item => { printCopies.value[item.rowId] ??= '1'; });
    }
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause instanceof Error ? cause.message : '订单明细读取失败，请重试';
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}

onMounted(() => { void load(); void loadCounts(); });
onUnmounted(() => { controller?.abort(); countRequest?.abort(); });
</script>

<template>
  <PrintPreview v-if="previewOpen" :order="order" :details="details" :counts="counts" :print-copies="printCopies" :simulate="simulatePreview" @back="closePreview" />
  <div class="detail-screen">
    <Navbar title="到货明细" :fixed="false" left-arrow @left-click="back" />
    <header class="order-heading">
      <strong>{{ order.orderNo }}（{{ order.vendorName || '未填写' }}）</strong>
      <p>{{ order.departmentName || '未填写' }} · {{ order.orderDate }}</p>
      <div class="detail-filters">
        <Search v-model="keyword" placeholder="搜索物料" :disabled="submitting" />
      </div>
    </header>
    <main class="detail-content" :aria-busy="loading">
      <div v-if="error" class="state" role="alert">
        <Empty :description="error" />
        <Button theme="primary" @click="load">重新加载</Button>
      </div>
      <div v-else-if="loading" class="state" role="status">
        <Loading text="正在加载订单明细" />
      </div>
      <Empty v-else-if="!details.length" description="暂无订单明细" />
      <template v-else>
        <div v-if="!counts && !countError" class="state" role="status">
          <Loading text="正在读取打印次数" />
        </div>
        <div v-if="countError" class="state" role="alert">
          <p>{{ countError }}</p>
          <Button size="small" @click="loadCounts">重试读取次数</Button>
        </div>
        <Empty v-if="!visibleItems.length" description="暂无匹配物料" />
        <article v-for="item in details" :hidden="!visibleItems.includes(item)" :key="item.rowId" class="detail-card" :class="{ picked: selected.includes(item.rowId), printed: (counts?.[item.rowId] ?? 0) > 0 }">
          <div class="detail-heading">
            <Checkbox :checked="selected.includes(item.rowId)" :disabled="submitting" @change="checked => choose(item.rowId, checked)">{{ item.inventoryName }}</Checkbox>
            <Tag v-if="counts" variant="light">{{ counts[item.rowId] ? `已打印${counts[item.rowId]}次` : '未打印' }}</Tag>
          </div>
          <p class="detail-meta">{{ item.inventoryCode }} · {{ item.spec || '无规格' }}</p>
          <p class="detail-qty">订单数量 <strong>{{ item.quantity }}</strong></p>
          <label class="copies-row">
            <span>打印份数</span>
            <input
              type="number"
              :value="printCopies[item.rowId] || '1'"
              min="1"
              max="10000"
              :disabled="submitting"
              @input="toggleCopies(item.rowId, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </article>
      </template>
    </main>
    <footer v-if="!loading && !error && details.length" class="detail-footer">
      <component :is="devTools" v-if="devTools" :disabled="!selected.length" @simulate="preparePreview(true)" />
      <div class="footer-actions">
        <Button theme="light" :disabled="submitting" :aria-pressed="allSelected" @click="all(!allSelected)">
          {{ allSelected ? '取消全选' : '全选' }}
        </Button>
        <Button theme="primary" :loading="submitting" :disabled="!selected.length" @click="preparePreview(false)">
          打印预览
        </Button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.detail-screen {
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
.order-heading {
  padding: var(--td-spacer-2);
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
  overflow-wrap: anywhere;
}
.order-heading p {
  margin: var(--td-spacer-1) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-medium);
}
.detail-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--td-spacer-2) var(--td-spacer-2) max(var(--td-spacer-3), env(safe-area-inset-bottom));
}
.detail-card {
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
  padding: var(--td-spacer-2);
  margin-bottom: var(--td-spacer-2);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-large);
  background: var(--td-bg-color-container);
  overflow-wrap: anywhere;
}
.detail-card.printed {
  background: var(--td-success-color-2);
}
.detail-card.picked {
  border-color: var(--td-brand-color);
}
.detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-spacer-2);
}
.detail-heading :deep(.t-checkbox__label) {
  font-weight: 600;
}
.detail-heading :deep(.t-tag) {
  flex-shrink: 0;
}
.detail-meta {
  margin: var(--td-spacer-1) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-medium);
}
.detail-qty {
  margin: var(--td-spacer-1) 0 0;
  font-size: var(--td-font-size-body-medium);
}
.copies-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-spacer-2);
  margin-top: var(--td-spacer-2);
  font-size: var(--td-font-size-body-medium);
}
.copies-row input {
  width: 88px;
  height: 36px;
  padding: 0 var(--td-spacer-1);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
  text-align: right;
  font: inherit;
}
.state {
  display: grid;
  justify-items: center;
  gap: var(--td-spacer-3);
  padding: var(--td-spacer-4) 0;
}
.detail-footer {
  position: relative;
  padding: var(--td-spacer-2) var(--td-spacer-2) max(var(--td-spacer-2), env(safe-area-inset-bottom));
  background: var(--td-bg-color-container);
  border-top: 1px solid var(--td-component-border);
}
.detail-filters {
  margin-top: var(--td-spacer-2);
}
.footer-actions {
  display: flex;
  gap: var(--td-spacer-2);
}
.footer-actions > :last-child {
  flex: 1;
}
</style>