<script setup lang="ts">
// 工程结构克隆 wy-material-print/src/views/MaterialList.vue（顶部 Heading / 搜索 / 滚动内容 / 选中 /
// 全选 / 底部打印预览入口 / 返回栈 / 安全区）。业务字段：PO 明细物料 + 手动拆分配到生产计划号。
//
// 业务流：
//   1. 卡片显示物料 + 订单数量 + 打印份数 + 分配区（手动输入 "生产计划号 + 数量" 任意行）
//   2. 底部"剩余（自动计算）"实时显示；超过订单数量给出红色警告、阻止"确定"
//   3. 点击"确定" → 把分配列表随 print-operation 一起落到快照（后端持久化）
//   4. PrintPreview 展示标签，标签内容包含计划号

import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { Button, Checkbox, Empty, Input, Loading, Message, Navbar, Search, Tag, Toast } from 'tdesign-mobile-vue';
import CloseIcon from 'tdesign-icons-vue-next/esm/components/close';
import { getPurchaseOrder, getPrintCounts, type Allocation, type PurchaseOrder, type PurchaseOrderDetail } from '../api';
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

// Per-row list of {planNumber, quantity}. Each row starts with one empty input.
// Edited in place; the "remaining" computed derives from this map.
type AllocDraft = { planNumber: string; quantity: string };
const allocations = reactive<Record<number, AllocDraft[]>>({});

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

// ----- allocation editing -----

function ensureAllocRow(rowId: number) {
  if (!allocations[rowId]) allocations[rowId] = [{ planNumber: '', quantity: '' }];
}

function addAllocRow(rowId: number) {
  ensureAllocRow(rowId);
  allocations[rowId].push({ planNumber: '', quantity: '' });
}

function removeAllocRow(rowId: number, index: number) {
  const list = allocations[rowId];
  list.splice(index, 1);
  if (list.length === 0) list.push({ planNumber: '', quantity: '' });
}

function parsePositiveInt(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

const orderQtyOf = (rowId: number) => {
  const d = details.value.find(x => x.rowId === rowId);
  if (!d) return 0;
  const q = Number(d.quantity);
  return Number.isFinite(q) && q > 0 ? Math.floor(q) : 0;
};

const allocatedOf = (rowId: number) => {
  ensureAllocRow(rowId);
  return allocations[rowId].reduce((sum, row) => sum + parsePositiveInt(row.quantity), 0);
};

const remainingOf = (rowId: number) => orderQtyOf(rowId) - allocatedOf(rowId);

const allocSummaryOf = (rowId: number) => {
  const list = allocations[rowId] ?? [];
  return list.filter(row => row.planNumber.trim() !== '' && parsePositiveInt(row.quantity) > 0)
    .map<Allocation>(row => ({
      rowId,
      planNumber: row.planNumber.trim(),
      quantity: parsePositiveInt(row.quantity),
    }));
};

const overAllocated = (rowId: number) => remainingOf(rowId) < 0;

async function loadCounts() {
  countRequest?.abort();
  const request = new AbortController();
  countRequest = request;
  countError.value = '';
  try {
    const result = await getPrintCounts(props.order.poId, request.signal);
    if (!request.signal.aborted) counts.value = result.counts;
  } catch (cause) {
    if (!request.signal.aborted) { counts.value = undefined; countError.value = cause instanceof Error ? cause.message : '打印次数读取失败，请重试'; }
  }
}

function buildFlatAllocations(): Allocation[] {
  const flat: Allocation[] = [];
  for (const item of details.value) {
    if (!selected.value.includes(item.rowId)) continue;
    const summary = allocSummaryOf(item.rowId);
    if (summary.length) flat.push(...summary);
  }
  return flat;
}

function preparePreview(simulate = false) {
  if (!selected.value.length) return;
  // Block on negative remaining (data-entry error) but allow positive
  // remaining (partial split is normal for staged receiving).
  const bad = selected.value.filter(id => overAllocated(id));
  if (bad.length) {
    Toast({ message: '明细分配数量超过订单数量，请修改', theme: 'error', preventScrollThrough: false });
    return;
  }
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
  for (const k of Object.keys(allocations)) delete allocations[Number(k)];
  try {
    const result = await getPurchaseOrder(props.order.poId, request.signal);
    if (!request.signal.aborted) {
      details.value = result.details;
      details.value.forEach(item => {
        printCopies.value[item.rowId] ??= '1';
        ensureAllocRow(item.rowId);
      });
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
  <PrintPreview v-if="previewOpen" :order="order" :details="details" :counts="counts" :print-copies="printCopies" :allocations="buildFlatAllocations()" :simulate="simulatePreview" @back="closePreview" />
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
        <article v-for="item in details" :hidden="!visibleItems.includes(item)" :key="item.rowId" class="detail-card" :class="{ picked: selected.includes(item.rowId), printed: (counts?.[item.rowId] ?? 0) > 0, over: overAllocated(item.rowId) }">
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

          <div v-if="selected.includes(item.rowId)" class="alloc-block" :aria-label="`${item.inventoryName}生产计划号分配`">
            <p class="alloc-heading">分配到生产计划号</p>
            <div v-for="(row, idx) in allocations[item.rowId]" :key="idx" class="alloc-row">
              <Input
                v-model="row.planNumber"
                placeholder="计划号"
                :disabled="submitting"
                aria-label="生产计划号"
                class="alloc-plan"
              />
              <Input
                v-model="row.quantity"
                placeholder="数量"
                type="number"
                :disabled="submitting"
                aria-label="分配数量"
                class="alloc-qty"
              />
              <Button
                theme="light"
                size="small"
                variant="outline"
                :disabled="submitting"
                aria-label="删除分配行"
                @click="removeAllocRow(item.rowId, idx)"
              >
                <template #icon><CloseIcon aria-hidden="true" /></template>
              </Button>
            </div>
            <Button
              theme="light"
              size="small"
              variant="outline"
              block
              :disabled="submitting"
              @click="addAllocRow(item.rowId)"
            >
              + 添加分配行
            </Button>
            <p class="alloc-remaining" :class="{ negative: overAllocated(item.rowId) }">
              剩余（自动计算）<strong>{{ remainingOf(item.rowId) }}</strong>
            </p>
          </div>
        </article>
      </template>
    </main>
    <footer v-if="!loading && !error && details.length" class="detail-footer">
      <p
        v-if="selected.some(id => overAllocated(id))"
        class="over-banner"
        role="alert"
      >
        所选明细中存在分配数量超过订单数量的行，请修改后再确定
      </p>
      <component :is="devTools" v-if="devTools" :disabled="!selected.length || selected.some(id => overAllocated(id))" @simulate="preparePreview(true)" />
      <div class="footer-actions">
        <Button theme="light" :disabled="submitting" :aria-pressed="allSelected" @click="all(!allSelected)">
          {{ allSelected ? '取消全选' : '全选' }}
        </Button>
        <Button theme="primary" :loading="submitting" :disabled="!selected.length || selected.some(id => overAllocated(id))" @click="preparePreview(false)">
          确定
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
.alloc-block {
  margin-top: var(--td-spacer-2);
  padding-top: var(--td-spacer-2);
  border-top: 1px dashed var(--td-component-border);
}
.alloc-heading {
  margin: 0 0 var(--td-spacer-1);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.alloc-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px 36px;
  gap: var(--td-spacer-1);
  align-items: center;
  margin-bottom: var(--td-spacer-1);
}
.alloc-row :deep(.t-input) {
  min-width: 0;
}
.alloc-remaining {
  margin: var(--td-spacer-2) 0 0;
  text-align: right;
  font-size: var(--td-font-size-body-medium);
  color: var(--td-text-color-secondary);
}
.alloc-remaining.negative {
  color: var(--td-error-color);
}
.alloc-remaining strong {
  margin-left: var(--td-spacer-1);
}
.detail-card.over {
  border-color: var(--td-error-color);
}
.over-banner {
  margin: 0 0 var(--td-spacer-2);
  padding: var(--td-spacer-2);
  color: var(--td-error-color);
  background: var(--td-error-color-1);
  border-radius: var(--td-radius-default);
  font-size: var(--td-font-size-body-small);
  text-align: center;
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