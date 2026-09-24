<script setup lang="ts">
// 工程结构克隆 wy-material-print/src/views/MaterialList.vue（顶部 Heading / 搜索 / 滚动内容 / 选中 /
// 全选 / 底部打印预览入口 / 返回栈 / 安全区）。业务字段：PO 明细物料 + 手动拆分配到生产计划号。
//
// 业务流（采购员一次到货验收）：
//   1. 卡片显示物料 + 订单数量（参考用）
//   2. 验货员按现场到货批次逐行录入：生产计划号 + 数量；可继续加累计
//   3. 剩余数量 > 0 时，自动追加 1 行"剩余"行（计划号留空，让现场人员填；数量自动 = 剩余）
//   4. 卡片底部实时显示"剩余（自动计算）"
//   5. 点击"确定" → 卡片保存为修改后的样式（只读、显示每行的最终状态）
//                → PrintPreview 按分配行数 = 标签数展示（含剩余行）
//                → 后端落 print-operation 快照

import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Button, Checkbox, Empty, Input, Loading, Message, Navbar, Search, Tag, Toast } from 'tdesign-mobile-vue';
import CloseIcon from 'tdesign-icons-vue-next/esm/components/close';
import { getPurchaseOrder, getPrintCounts, type Allocation, type PurchaseOrder, type PurchaseOrderDetail } from '../api';
import PrintPreview from './PrintPreview.vue';
import PoArrivalDevTools from './PoArrivalDevTools.vue';
import { usePageBack } from '../pageBack';

const props = defineProps<{ order: PurchaseOrder }>();
const emit = defineEmits<{ back: [] }>();

const previewOpen = ref(false);
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
// `frozen = true` means the row was finalised by "确定" — the card locks into
// read-only mode and the inputs become non-editable.
type AllocDraft = { planNumber: string; quantity: string; frozen: boolean; isResidual: boolean };
const allocations = reactive<Record<number, AllocDraft[]>>({});
const frozenRows = ref<Set<number>>(new Set());

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

const unfrozenItemsCount = computed(() =>
  details.value.filter(item => !frozenRows.value.has(item.rowId)).length,
);

function choose(rowId: number, checked: boolean) {
  if (submitting.value) return;
  if (frozenRows.value.has(rowId)) return; // 不能修改已 frozen 的行
  selected.value = checked ? [...selected.value, rowId] : selected.value.filter(id => id !== rowId);
}
function all(checked: boolean) {
  if (submitting.value) return;
  const ids = new Set(visibleItems.value.filter(item => !frozenRows.value.has(item.rowId)).map(item => item.rowId));
  selected.value = checked ? [...new Set([...selected.value, ...ids])] : selected.value.filter(id => !ids.has(id));
}

// ----- allocation editing -----

function ensureAllocRow(rowId: number) {
  if (!allocations[rowId]) {
    allocations[rowId] = [{ planNumber: '', quantity: '', frozen: false, isResidual: false }];
  }
}

function addAllocRow(rowId: number) {
  if (frozenRows.value.has(rowId)) return;
  ensureAllocRow(rowId);
  // 不让用户手动加 "剩余" 行 — 那一行始终是自动追加的最后一行。
  const list = allocations[rowId];
  // 把残留的 "剩余" 自动行抽出来
  const residual = list.find(row => row.isResidual);
  const realRows = list.filter(row => !row.isResidual);
  realRows.push({ planNumber: '', quantity: '', frozen: false, isResidual: false });
  allocations[rowId] = residual ? [...realRows, residual] : realRows;
  appendResidualIfNeeded(rowId);
}

function removeAllocRow(rowId: number, index: number) {
  if (frozenRows.value.has(rowId)) return;
  const list = allocations[rowId];
  // Cannot remove the auto-residual row either.
  if (list[index]?.isResidual) return;
  list.splice(index, 1);
  if (list.length === 0) list.push({ planNumber: '', quantity: '', frozen: false, isResidual: false });
  appendResidualIfNeeded(rowId);
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

const realAllocationsOf = (rowId: number): AllocDraft[] =>
  (allocations[rowId] ?? []).filter(r => !r.isResidual);

const allocatedOf = (rowId: number) =>
  realAllocationsOf(rowId).reduce((sum, row) => sum + parsePositiveInt(row.quantity), 0);

const remainingOf = (rowId: number) => orderQtyOf(rowId) - allocatedOf(rowId);

const overAllocated = (rowId: number) => remainingOf(rowId) < 0;

// 剩余 > 0 时，确保列表末尾有一条自动"剩余"行（计划号空，quantity=剩余）；
// 剩余 == 0 时移除任何残留的"剩余"行。
function appendResidualIfNeeded(rowId: number) {
  const list = allocations[rowId];
  if (!list) return;
  const residualIdx = list.findIndex(r => r.isResidual);
  const rem = remainingOf(rowId);
  if (rem > 0) {
    if (residualIdx === -1) {
      list.push({ planNumber: '', quantity: String(rem), frozen: false, isResidual: true });
    } else {
      list[residualIdx].quantity = String(rem);
    }
  } else if (residualIdx !== -1) {
    list.splice(residualIdx, 1);
  }
}

// 当任何数量字段变化时，自动重算"剩余"行
watch(
  () => JSON.stringify(allocations),
  () => {
    for (const rowIdStr of Object.keys(allocations)) {
      const rowId = Number(rowIdStr);
      if (!frozenRows.value.has(rowId)) appendResidualIfNeeded(rowId);
    }
  },
);

// 校验。订单数量 == 拆分配额 + 1 张剩余行 → 通过；超额 → 阻止。
const validSummaryFor = (rowId: number) => {
  const list = allocations[rowId] ?? [];
  // 每条 "实际行" 都需要 planNumber + quantity > 0
  const reals = list.filter(r => !r.isResidual);
  const realValid = reals.every(r => r.planNumber.trim() !== '' && parsePositiveInt(r.quantity) > 0);
  return realValid && !overAllocated(rowId);
};

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

// "确定"：冻结当前每张选中卡片的分配列表，进入只读 + 弹出打印预览
function preparePreview(simulate = false) {
  if (!selected.value.length) return;
  const bad = selected.value.filter(id => !validSummaryFor(id));
  if (bad.length) {
    Toast({ message: '请确认每张卡片的分配行都已填齐、且未超额', theme: 'error', preventScrollThrough: false });
    return;
  }
  // 冻结：之后不能改
  for (const rowId of selected.value) {
    const list = allocations[rowId];
    if (list) for (const row of list) row.frozen = true;
    frozenRows.value.add(rowId);
    frozenRows.value = new Set(frozenRows.value);
    // 选中行自动取消（已经"完成"，不再需要勾选）
    selected.value = selected.value.filter(id => id !== rowId);
  }
  simulatePreview.value = simulate;
  previewOpen.value = true;
}

// 收集用于预览 / 后端的 Allocation 列表。每行 1 张标签，包括"剩余"行。
function buildFlatAllocations(): Allocation[] {
  const flat: Allocation[] = [];
  for (const [rowIdStr, list] of Object.entries(allocations)) {
    const rowId = Number(rowIdStr);
    if (!frozenRows.value.has(rowId)) continue;
    for (const row of list) {
      const plan = row.planNumber.trim();
      const qty = parsePositiveInt(row.quantity);
      if (qty <= 0) continue;
      flat.push({ rowId, planNumber: plan, quantity: qty });
    }
  }
  return flat;
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
  frozenRows.value = new Set();
  try {
    const result = await getPurchaseOrder(props.order.poId, request.signal);
    if (!request.signal.aborted) {
      details.value = result.details;
      details.value.forEach(item => {
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
  <PrintPreview v-if="previewOpen" :order="order" :details="details" :counts="counts" :allocations="buildFlatAllocations()" :simulate="simulatePreview" @back="closePreview" />
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
        <article v-for="item in details" :hidden="!visibleItems.includes(item)" :key="item.rowId" class="detail-card" :class="{ picked: selected.includes(item.rowId), printed: (counts?.[item.rowId] ?? 0) > 0, over: !frozenRows.has(item.rowId) && overAllocated(item.rowId), frozen: frozenRows.has(item.rowId) }">
          <div class="detail-heading">
            <Checkbox :checked="selected.includes(item.rowId)" :disabled="submitting || frozenRows.has(item.rowId)" @change="checked => choose(item.rowId, checked)">{{ item.inventoryName }}</Checkbox>
            <Tag v-if="frozenRows.has(item.rowId)" variant="light" theme="success">已完成</Tag>
            <Tag v-else-if="counts" variant="light">{{ counts[item.rowId] ? `已打印${counts[item.rowId]}次` : '未打印' }}</Tag>
          </div>
          <p class="detail-meta">{{ item.inventoryCode }} · {{ item.spec || '无规格' }}</p>
          <p class="detail-qty">订单数量 <strong>{{ item.quantity }}</strong></p>

          <div class="alloc-block" :aria-label="`${item.inventoryName}生产计划号分配`">
            <p class="alloc-heading">分配到生产计划号</p>
            <div v-for="(row, idx) in allocations[item.rowId] ?? []" :key="idx" class="alloc-row" :class="{ residual: row.isResidual, frozen: row.frozen }">
              <Input
                v-model="row.planNumber"
                :placeholder="row.isResidual ? '剩余（计划号可填）' : '计划号'"
                :disabled="submitting || row.frozen"
                aria-label="生产计划号"
                class="alloc-plan"
              />
              <Input
                v-model="row.quantity"
                placeholder="数量"
                type="number"
                :disabled="submitting || row.frozen || row.isResidual"
                aria-label="分配数量"
                class="alloc-qty"
              />
              <Button
                v-if="!row.frozen && !row.isResidual"
                theme="light"
                size="small"
                variant="outline"
                :disabled="submitting"
                aria-label="删除分配行"
                @click="removeAllocRow(item.rowId, idx)"
              >
                <template #icon><CloseIcon aria-hidden="true" /></template>
              </Button>
              <span v-else-if="row.isResidual" class="alloc-tag">剩余</span>
            </div>
            <Button
              v-if="!frozenRows.has(item.rowId)"
              theme="light"
              size="small"
              variant="outline"
              block
              :disabled="submitting"
              @click="addAllocRow(item.rowId)"
            >
              + 添加分配行
            </Button>
            <p v-if="!frozenRows.has(item.rowId)" class="alloc-remaining" :class="{ negative: overAllocated(item.rowId) }">
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
      <component :is="devTools" v-if="devTools" :disabled="!selected.length || selected.some(id => !validSummaryFor(id))" @simulate="preparePreview(true)" />
      <div class="footer-actions">
        <Button theme="light" :disabled="submitting || !unfrozenItemsCount" :aria-pressed="allSelected" @click="all(!allSelected)">
          {{ allSelected ? '取消全选' : '全选' }}
        </Button>
        <Button theme="primary" :loading="submitting" :disabled="!selected.length || selected.some(id => !validSummaryFor(id))" @click="preparePreview(false)">
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
.detail-card.frozen {
  background: var(--td-bg-color-container);
  border-color: var(--td-success-color);
}
.alloc-row.residual {
  background: var(--td-warning-color-1);
  border-radius: var(--td-radius-default);
  padding: var(--td-spacer-1);
}
.alloc-row.frozen {
  opacity: 0.85;
}
.alloc-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 var(--td-spacer-2);
  color: var(--td-warning-color);
  font-size: var(--td-font-size-body-small);
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