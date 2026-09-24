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
import { getPurchaseOrder, getPrintCounts, createReceipts, updateReceipt, type Allocation, type PurchaseOrder, type PurchaseOrderDetailRow, type Receipt } from '../api';
import PrintPreview from './PrintPreview.vue';
import PoArrivalDevTools from './PoArrivalDevTools.vue';
import { usePageBack } from '../pageBack';

const props = defineProps<{ order: PurchaseOrder }>();
const emit = defineEmits<{ back: [] }>();

const previewOpen = ref(false);
const devTools = import.meta.env.DEV ? PoArrivalDevTools : null;
const simulatePreview = ref(false);

const details = ref<PurchaseOrderDetailRow[]>([]);
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
type AllocDraft = { id: string; planNumber: string; quantity: string; frozen: boolean; isResidual: boolean; receiptId?: string };
const allocations = reactive<Record<number, AllocDraft[]>>({});
const frozenRows = ref<Set<number>>(new Set());

// 编辑 receipts 时的本地草稿：保存未保存的 planNumber/quantity 直至 blur/enter。
// receiptId -> { planNumber, quantity }。
const receiptDrafts = reactive<Record<string, { planNumber: string; quantity: string }>>({});

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
const frozenCount = computed(() => frozenRows.value.size);

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
    allocations[rowId] = [{ id: newLocalId(), planNumber: '', quantity: '', frozen: false, isResidual: false }];
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
  realRows.push({ id: newLocalId(), planNumber: '', quantity: '', frozen: false, isResidual: false });
  allocations[rowId] = residual ? [...realRows, residual] : realRows;
  appendResidualIfNeeded(rowId);
}

function removeAllocRow(rowId: number, index: number) {
  if (frozenRows.value.has(rowId)) return;
  const list = allocations[rowId];
  // Cannot remove the auto-residual row either.
  if (list[index]?.isResidual) return;
  list.splice(index, 1);
  if (list.length === 0) list.push({ id: newLocalId(), planNumber: '', quantity: '', frozen: false, isResidual: false });
  appendResidualIfNeeded(rowId);
}

// 当前正在填的草稿总额（仅 non-residual + 有效值）。用于"本次剩余"实时显示。
const parseTotalInDraft = (rowId: number) =>
  (allocations[rowId] ?? []).filter(r => !r.isResidual).reduce((sum, r) => sum + parsePositiveInt(r.quantity), 0);

// crypto.randomUUID 在 http（无 secure context）/ 老 PDA 浏览器 / 某些 webview 下不可用。
// 后端 receipt id 由 server 返回，这里只是 key — 不需要 RFC UUID 严格性，Math.random 足够。
function newLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parsePositiveInt(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

// 剩余可拆量 = 订单数量 - 已验收累计。该明细在 receivedQuantity === orderQuantity
// 时彻底完成，无可拆量。历史验收记录来自后端 receipts，渲染为不可改的 frozen 行。
const orderQtyOf = (rowId: number) => {
  const d = details.value.find(x => x.rowId === rowId);
  if (!d) return 0;
  const q = Number(d.quantity);
  return Number.isFinite(q) && q > 0 ? Math.floor(q) : 0;
};
const receivedQtyOf = (rowId: number) => {
  const d = details.value.find(x => x.rowId === rowId);
  return d?.receivedQuantity ?? 0;
};
const remainingBudgetOf = (rowId: number) =>
  Math.max(0, orderQtyOf(rowId) - receivedQtyOf(rowId));

const realAllocationsOf = (rowId: number): AllocDraft[] =>
  (allocations[rowId] ?? []).filter(r => !r.isResidual);

const allocatedOf = (rowId: number) =>
  realAllocationsOf(rowId).reduce((sum, row) => sum + parsePositiveInt(row.quantity), 0);

// "剩余" = 订单数量 - 已存累计 - 草稿累计。给用户看，提示还能再拆多少。
const remainingOf = (rowId: number) =>
  Math.max(0, remainingBudgetOf(rowId) - parseTotalInDraft(rowId));

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
      list.push({ id: newLocalId(), planNumber: '', quantity: String(rem), frozen: false, isResidual: true });
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

// 校验。草稿总额不能超过剩余可拆（订单 - 已存累计）。
const validSummaryFor = (rowId: number) => {
  const list = allocations[rowId] ?? [];
  // 每条 "实际行" 都需要 planNumber + quantity > 0
  const reals = list.filter(r => !r.isResidual);
  const realValid = reals.every(r => r.planNumber.trim() !== '' && parsePositiveInt(r.quantity) > 0);
  if (!realValid) return false;
  // 不能超过剩余可拆
  return parseTotalInDraft(rowId) <= remainingBudgetOf(rowId);
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

// "确定"：立刻落 receipts（不可变历史），冻结卡片，复用本地 allocations 给预览。
// 打印与落库完全解耦——即使预览关闭 / 不打印，本次验收也保留。
async function commitReceipts() {
  if (!selected.value.length) return;
  const bad = selected.value.filter(id => !validSummaryFor(id));
  if (bad.length) {
    Toast({ message: '请确认每张卡片的分配行都已填齐、且未超额', theme: 'error', preventScrollThrough: false });
    return;
  }
  submitting.value = true;
  try {
    // 只提交"新"行（无 receiptId）。已解锁的行由于前端 receiptId 已删，
    // 重新编辑后会作为新行提交；后端先 DELETE 再 POST 等价。
    const flat: Allocation[] = [];
    for (const rowId of selected.value) {
      for (const row of allocations[rowId] ?? []) {
        if (row.isResidual) continue;
        if (row.receiptId) continue; // 已 saved，跳过
        const plan = row.planNumber.trim();
        const qty = parsePositiveInt(row.quantity);
        if (qty <= 0) continue;
        flat.push({ rowId, planNumber: plan, quantity: qty });
      }
    }
    if (!flat.length) {
      Toast({ message: '没有可保存的分配行（全部已存）', theme: 'warning', preventScrollThrough: false });
      return;
    }
    const result = await createReceipts(props.order.poId, flat);
    // 把后端回执的 ids/timestamps 合并到本地 allocations，并标记 frozen。
    const idByKey = new Map<string, string>();
    for (const r of result.receipts) {
      idByKey.set(`${r.rowId}|${r.planNumber}|${r.quantity}`, r.id);
    }
    for (const rowId of selected.value) {
      const list = allocations[rowId] ?? [];
      for (const row of list) {
        if (row.isResidual) continue;
        const key = `${rowId}|${row.planNumber.trim()}|${parsePositiveInt(row.quantity)}`;
        const id = idByKey.get(key);
        if (id) (row as AllocDraft & { receiptId?: string }).receiptId = id;
        row.frozen = true;
      }
      frozenRows.value.add(rowId);
    }
    frozenRows.value = new Set(frozenRows.value);
    // 选中行清空（已冻结），并把详情里的 receivedQuantity 加上本次提交的总额（避免再次 GET）。
    const submittedByRow = new Map<number, number>();
    for (const a of flat) submittedByRow.set(a.rowId, (submittedByRow.get(a.rowId) ?? 0) + a.quantity);
    for (const d of details.value) {
      const inc = submittedByRow.get(d.rowId);
      if (inc) d.receivedQuantity = (d.receivedQuantity ?? 0) + inc;
    }
    selected.value = [];
    // 后端 frozen 行的 receipts 列表插入已展示快照，供后续 UI 立刻看。
    for (const r of result.receipts) {
      const d = details.value.find(x => x.rowId === r.rowId);
      if (!d) continue;
      if (!d.receipts) d.receipts = [];
      d.receipts.push(r as Receipt);
    }
    Toast({ message: '本次到货验收已保存', theme: 'success', duration: 1500, preventScrollThrough: false });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '保存失败，请重试';
    Toast({ message, theme: 'error', preventScrollThrough: false });
  } finally {
    submitting.value = false;
  }
}

// 修改一条已存的 receipt：in-place PUT（后端 transaction 校验 + 持久化）。
// 不需要"解锁"动作——输入框本身即可编辑，blur 时直接落库。
async function saveReceiptEdit(rowId: number, receipt: Receipt, planNumber: string, quantity: number) {
  // Skip when the value didn't actually change (Enter on same value, etc.).
  if (planNumber === receipt.planNumber && quantity === receipt.quantity) return;
  if (quantity < 1) {
    Toast({ message: '数量必须大于 0', theme: 'error', preventScrollThrough: false });
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    const updated = await updateReceipt(receipt.id, props.order.poId, rowId, planNumber, quantity);
    // Replace in details[].receipts and update receivedQuantity diff.
    const d = details.value.find(x => x.rowId === rowId);
    if (d?.receipts) {
      const idx = d.receipts.findIndex(r => r.id === receipt.id);
      if (idx >= 0) {
        const oldQty = d.receipts[idx].quantity;
        d.receipts[idx] = updated;
        d.receivedQuantity = Math.max(0, (d.receivedQuantity ?? 0) - oldQty + quantity);
      }
    }
    Toast({ message: '已保存修改', theme: 'success', duration: 1200, preventScrollThrough: false });
  } catch (cause) {
    Toast({ message: cause instanceof Error ? cause.message : '保存失败', theme: 'error', preventScrollThrough: false });
  } finally {
    submitting.value = false;
  }
}

// 仅用于打印预览：从 frozen 行的本地分配构建预览 allocations。
// 与 commitReceipts 不同 — 打印只决定哪些标签要打，receipts 才是已保存事实。
function openPreview(simulate = false) {
  simulatePreview.value = simulate;
  previewOpen.value = true;
}

// "打印已存" 用：基于后端 receipts 历史构造预览 allocations。
// （"确定" 后 receipts 持久化了，"打印" 复用 receipts 而不是本地 frozen 草稿；
// 这样即便用户编辑 UI 又关掉，再点"打印"也能正确打印已落库的事实。）
function buildFlatAllocations(): Allocation[] {
  const flat: Allocation[] = [];
  for (const d of details.value) {
    if (!d.receipts?.length) continue;
    for (const r of d.receipts) {
      flat.push({ rowId: d.rowId, planNumber: r.planNumber, quantity: r.quantity });
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
          <p class="detail-qty">
              订单数量 <strong>{{ item.quantity }}</strong>
              <span v-if="(item.receivedQuantity ?? 0) > 0" class="qty-received">已到货 {{ item.receivedQuantity }}</span>
              <span class="qty-remaining" :class="{ zero: remainingBudgetOf(item.rowId) === 0 }">可拆 {{ remainingBudgetOf(item.rowId) }}</span>
            </p>

          <div class="alloc-block" :aria-label="`${item.inventoryName}生产计划号分配`">
            <p class="alloc-heading">分配到生产计划号</p>

            <!-- 已验收历史行（来自后端 receipts）— 可在位编辑 + blur 自动保存 -->
            <template v-if="(item.receipts ?? []).length">
              <div v-for="r in item.receipts" :key="r.id" class="alloc-row historical">
                <Input
                  :model-value="receiptDrafts[r.id]?.planNumber ?? r.planNumber"
                  @update:model-value="(val: string | number) => { receiptDrafts[r.id] = { ...(receiptDrafts[r.id] ?? { planNumber: r.planNumber, quantity: String(r.quantity) }), planNumber: String(val) }; }"
                  @blur="saveReceiptEdit(item.rowId, r, receiptDrafts[r.id]?.planNumber ?? r.planNumber, parsePositiveInt(receiptDrafts[r.id]?.quantity ?? String(r.quantity)))"
                  @enter="saveReceiptEdit(item.rowId, r, receiptDrafts[r.id]?.planNumber ?? r.planNumber, parsePositiveInt(receiptDrafts[r.id]?.quantity ?? String(r.quantity)))"
                  placeholder="计划号"
                  aria-label="生产计划号（已保存）"
                  class="alloc-plan"
                />
                <Input
                  :model-value="receiptDrafts[r.id]?.quantity ?? String(r.quantity)"
                  @update:model-value="(val: string | number) => { receiptDrafts[r.id] = { ...(receiptDrafts[r.id] ?? { planNumber: r.planNumber, quantity: String(r.quantity) }), quantity: String(val) }; }"
                  @blur="saveReceiptEdit(item.rowId, r, receiptDrafts[r.id]?.planNumber ?? r.planNumber, parsePositiveInt(receiptDrafts[r.id]?.quantity ?? String(r.quantity)))"
                  @enter="saveReceiptEdit(item.rowId, r, receiptDrafts[r.id]?.planNumber ?? r.planNumber, parsePositiveInt(receiptDrafts[r.id]?.quantity ?? String(r.quantity)))"
                  type="number"
                  placeholder="数量"
                  aria-label="数量（已保存）"
                  class="alloc-qty"
                />
                <span class="alloc-tag">已存</span>
              </div>
            </template>

            <!-- 新可拆分配区（仅当 remainingBudgetOf > 0 且未全冻）-->
            <template v-if="remainingBudgetOf(item.rowId) > 0">
              <div v-for="(row, idx) in allocations[item.rowId] ?? []" :key="`new-${row.id}`" class="alloc-row" :class="{ residual: row.isResidual }">
                <Input
                  v-model="row.planNumber"
                  :placeholder="row.isResidual ? '剩余（计划号可填）' : '计划号'"
                  :disabled="submitting"
                  aria-label="生产计划号"
                  class="alloc-plan"
                />
                <Input
                  v-model="row.quantity"
                  placeholder="数量"
                  type="number"
                  :disabled="submitting || row.isResidual"
                  aria-label="分配数量"
                  class="alloc-qty"
                />
                <Button
                  v-if="!row.isResidual"
                  theme="light"
                  size="small"
                  variant="outline"
                  :disabled="submitting"
                  aria-label="删除分配行"
                  @click="removeAllocRow(item.rowId, idx)"
                >
                  <template #icon><CloseIcon aria-hidden="true" /></template>
                </Button>
                <span v-else class="alloc-tag">剩余</span>
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
              <p class="alloc-remaining" :class="{ negative: remainingBudgetOf(item.rowId) - parseTotalInDraft(item.rowId) < 0 }">
                本次剩余（自动计算）<strong>{{ remainingBudgetOf(item.rowId) - parseTotalInDraft(item.rowId) }}</strong>
                <span class="alloc-budget">可拆总额 {{ remainingBudgetOf(item.rowId) }}</span>
              </p>
            </template>
            <p v-else class="alloc-done">本次到货全部完成</p>
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
      <component :is="devTools" v-if="devTools" :disabled="!selected.length || selected.some(id => !validSummaryFor(id))" @simulate="openPreview(true)" />
      <div class="footer-actions">
        <Button theme="light" :disabled="submitting || !unfrozenItemsCount" :aria-pressed="allSelected" @click="all(!allSelected)">
          {{ allSelected ? '取消全选' : '全选' }}
        </Button>
        <Button theme="primary" :loading="submitting" :disabled="!selected.length || selected.some(id => !validSummaryFor(id))" @click="commitReceipts">
          确定
        </Button>
        <Button theme="light" :disabled="!frozenCount || submitting" @click="openPreview(false)">
          打印已存
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
.qty-received {
  margin-left: var(--td-spacer-2);
  color: var(--td-success-color);
  font-size: var(--td-font-size-body-small);
}
.qty-remaining {
  margin-left: var(--td-spacer-1);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.qty-remaining.zero {
  color: var(--td-success-color);
  font-weight: 600;
}
.alloc-budget {
  margin-left: var(--td-spacer-2);
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}
.alloc-done {
  margin: var(--td-spacer-2) 0 0;
  padding: var(--td-spacer-2);
  background: var(--td-success-color-1);
  color: var(--td-success-color);
  border-radius: var(--td-radius-default);
  text-align: center;
  font-size: var(--td-font-size-body-small);
}
.alloc-row.historical {
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
  padding: var(--td-spacer-1);
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
  grid-template-columns: minmax(0, 1fr) 96px 36px auto;
  gap: var(--td-spacer-1);
  align-items: center;
  margin-bottom: var(--td-spacer-1);
}
.alloc-row.historical {
  grid-template-columns: minmax(0, 1fr) 96px 36px;
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