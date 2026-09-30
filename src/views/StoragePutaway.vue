<script setup lang="ts">
/**
 * StoragePutaway.vue - 采购入库扫码页面
 *
 * Issue #72 (2026-09-30): PDA 采购入库扫码 UI
 *
 * 业务流程：
 * 1. 仓库操作员扫"采购到货收货"标签 QR（编码 = PurchaseArrivalReceipt.id = UUID）；
 * 2. 后端按 UUID 查 receipts 表 + 实时调 U8 拼详情（物品名、采购日期、到货日期、规格、供应商）；
 * 3. 操作员手动从 U8 Warehouse 主表选仓库，手动填货架号和上架数量；
 * 4. 重复 2-3 直至全部上架完成（累计 <= receipt.quantity）；
 * 5. 提交入库（后端写 storage_putaways 表，记录操作人）。
 */

import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Button, Cell, Input, Navbar, Popup, Radio, Tag, Toast } from 'tdesign-mobile-vue';
import {
  createPutaway,
  getReceiptPutawayStatus,
  getReceiptWithDetail,
  listWarehouses,
  type ReceiptWithDetail,
  type U8Warehouse,
} from '../api';
import { initShell, onScan } from '../shell';
import { leaveToPortal } from '../portal';

// 状态机：scan-receipt → select-warehouse → enter-location → success
type PageState = 'scan-receipt' | 'select-warehouse' | 'enter-location' | 'success';

const currentState = ref<PageState>('scan-receipt');

// 从本系统 + U8 实时拼出的 receipt 详情
const receipt = ref<ReceiptWithDetail | null>(null);
// 已上架累计（实时从 storage/receipts/{id}/status 读）
const putawayQuantity = ref(0);
const remainingQuantity = ref(0);

// 仓库下拉
const warehouses = ref<U8Warehouse[]>([]);
const selectedWarehouse = ref<U8Warehouse | null>(null);

// 当前批次（一个 receipt 可能分多次上架）
interface PendingBatch {
  warehouseCode: string;
  warehouseName: string;
  locationCode: string;
  quantity: number;
}
const pendingBatches = ref<PendingBatch[]>([]);

// 单次输入的货架号 + 数量
const currentLocationCode = ref('');
const currentQuantity = ref<number | ''>('');

// 仓库选择 Popup
const showWarehousePicker = ref(false);

// 加载 / 错误
const loading = ref(false);
const lastScanError = ref('');

// 当前扫码码（用于 UI 显示，方便用户看是否被 PDA 接收）
const lastScanCode = ref('');

// ---------- 初始化 ----------
let unsubscribeScan: (() => void) | undefined;
let warehouseAbort: AbortController | undefined;

onMounted(async () => {
  initShell();
  unsubscribeScan = onScan(handleScan);
  await loadWarehouses();
});

onUnmounted(() => {
  unsubscribeScan?.();
  warehouseAbort?.abort();
});

async function loadWarehouses() {
  warehouseAbort?.abort();
  warehouseAbort = new AbortController();
  try {
    warehouses.value = await listWarehouses(warehouseAbort.signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    console.error('加载仓库列表失败', e);
    Toast({ message: '仓库列表读取失败，请检查网络', theme: 'warning' });
  }
}

// ---------- 扫码 → receipt 详情 ----------
async function handleScan(rawCode: string) {
  lastScanCode.value = rawCode;
  const receiptId = parseReceiptId(rawCode);
  if (receiptId === null) {
    lastScanError.value = `无法识别二维码内容：${rawCode}`;
    Toast({ message: lastScanError.value, theme: 'warning' });
    return;
  }
  if (receipt.value && currentState.value !== 'scan-receipt' && currentState.value !== 'success') {
    // 第一遍扫 receipt；扫了之后用户进入仓库/货架流；再扫一次 receipt 视为"换单"。
    if (receiptId === receipt.value.receiptId) return; // 重复扫码忽略
  }
  await loadReceipt(receiptId);
}

function parseReceiptId(raw: string): string | null {
  // H5 标签 QR 编码 = PurchaseArrivalReceipt.id（UUID 字符串）。
  // 兼容：8-4-4-4-12 标准格式 / 32 位无连字符。
  const trimmed = raw.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    const v = trimmed.toLowerCase();
    return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
  }
  return null;
}

async function loadReceipt(receiptId: string) {
  loading.value = true;
  lastScanError.value = '';
  try {
    // 1) receipt 详情是必须的：拿不到就拒绝进入下一步。
    const info = await getReceiptWithDetail(receiptId);
    receipt.value = info;
    pendingBatches.value = [];
    currentState.value = 'select-warehouse';
    const name = info.u8?.inventory_name ?? `订单 ${info.poId}`;
    Toast({ message: `已扫码：${name}`, theme: 'success' });

    // 2) 上架状态是参考性的：拿不到不影响主流程，单独处理错误。
    try {
      const status = await getReceiptPutawayStatus(receiptId);
      putawayQuantity.value = status.putawayQuantity;
      remainingQuantity.value = status.remainingQuantity;
    } catch (statusErr) {
      // 上架状态失败时按"未上架"展示，避免阻塞入库操作。
      putawayQuantity.value = 0;
      remainingQuantity.value = info.quantity;
      console.warn('上架状态读取失败，按未上架继续', statusErr);
    }
  } catch (e) {
    lastScanError.value = e instanceof Error ? e.message : '扫码解析失败';
    Toast({ message: lastScanError.value, theme: 'error' });
  } finally {
    loading.value = false;
  }
}

// ---------- 仓库选择 ----------
function chooseWarehouse(w: U8Warehouse) {
  selectedWarehouse.value = w;
  showWarehousePicker.value = false;
  currentLocationCode.value = '';
  currentQuantity.value = '';
  currentState.value = 'enter-location';
}

// ---------- 单批次上架 ----------
function confirmBatch() {
  if (!selectedWarehouse.value) {
    Toast({ message: '请先选择仓库', theme: 'warning' });
    return;
  }
  const qty = Number(currentQuantity.value);
  if (!currentLocationCode.value.trim()) {
    Toast({ message: '请填写货架号', theme: 'warning' });
    return;
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    Toast({ message: '请填写正确的上架数量', theme: 'warning' });
    return;
  }
  if (qty > remainingQuantity.value) {
    Toast({
      message: `超过剩余可上架数量 ${remainingQuantity.value} 件`,
      theme: 'warning',
    });
    return;
  }
  pendingBatches.value.push({
    warehouseCode: selectedWarehouse.value.code,
    warehouseName: selectedWarehouse.value.name,
    locationCode: currentLocationCode.value.trim(),
    quantity: qty,
  });
  currentLocationCode.value = '';
  currentQuantity.value = '';
  Toast({ message: '已加入本批入库', theme: 'success' });
}

function removeBatch(index: number) {
  pendingBatches.value.splice(index, 1);
}

// ---------- 提交 ----------
async function submitPutaway() {
  if (!receipt.value) {
    Toast({ message: '缺少收货记录信息', theme: 'error' });
    return;
  }
  if (pendingBatches.value.length === 0) {
    Toast({ message: '请先添加上架批次', theme: 'warning' });
    return;
  }
  loading.value = true;
  try {
    for (const batch of pendingBatches.value) {
      await createPutaway({
        receiptId: receipt.value.receiptId,
        locationCode: batch.locationCode,
        quantity: batch.quantity,
        isLineSide: false,
      });
    }
    // 重新拉 status
    const status = await getReceiptPutawayStatus(receipt.value.receiptId);
    putawayQuantity.value = status.putawayQuantity;
    remainingQuantity.value = status.remainingQuantity;
    currentState.value = 'success';
    Toast({ message: '入库成功', theme: 'success' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '入库失败，请重试';
    Toast({ message: msg, theme: 'error' });
  } finally {
    loading.value = false;
  }
}

// ---------- 流程控制 ----------
function goBack() {
  leaveToPortal();
}

function restart() {
  receipt.value = null;
  selectedWarehouse.value = null;
  pendingBatches.value = [];
  currentLocationCode.value = '';
  currentQuantity.value = '';
  putawayQuantity.value = 0;
  remainingQuantity.value = 0;
  lastScanError.value = '';
  currentState.value = 'scan-receipt';
}

function pickAgainWarehouse() {
  selectedWarehouse.value = null;
  currentLocationCode.value = '';
  currentQuantity.value = '';
  currentState.value = 'select-warehouse';
}

// ---------- 派生 ----------
const totalBatchedQuantity = computed(() =>
  pendingBatches.value.reduce((sum, b) => sum + b.quantity, 0),
);
const remainingAfterBatch = computed(() => remainingQuantity.value - totalBatchedQuantity.value);
</script>

<template>
  <div class="storage-putaway">
    <Navbar title="采购入库" left-icon="back" @click-left="goBack" />

    <!-- 状态 1: 扫收货 QR -->
    <div v-if="currentState === 'scan-receipt'" class="state-container">
      <div class="scan-prompt">
        <div class="scan-icon">📦</div>
        <h2>扫描收货标签</h2>
        <p>将 PDA 镜头对准"采购到货收货"标签右下角二维码；扫码后自动获取物品信息。</p>
        <p v-if="lastScanError" class="error-text">{{ lastScanError }}</p>
        <p v-else-if="lastScanCode" class="hint-text">最近扫码：{{ lastScanCode }}</p>
        <p v-else class="hint-text">在浏览器中扫码无效，请使用 PDA 设备</p>
      </div>
    </div>

    <!-- 状态 2: 选仓库 -->
    <div v-if="currentState === 'select-warehouse' && receipt" class="state-container">
      <div class="receipt-card">
        <div class="receipt-card-title">收货记录</div>
        <Cell
          title="订单号"
          :note="receipt.u8?.order_no || String(receipt.poId)"
        />
        <Cell
          title="物品"
          :note="receipt.u8?.inventory_name || '—'"
        />
        <Cell
          title="规格"
          :note="receipt.u8?.spec || '—'"
        />
        <Cell
          title="采购日期"
          :note="receipt.u8?.purchase_date ? receipt.u8.purchase_date.slice(0, 10) : '—'"
        />
        <Cell
          title="到货日期"
          :note="receipt.u8?.arrive_date ? receipt.u8.arrive_date.slice(0, 10) : '—'"
        />
        <Cell
          title="本次到货数量"
          :note="`${receipt.quantity} 件`"
        />
        <Cell
          title="已上架 / 剩余"
          :note="`${putawayQuantity} / ${remainingQuantity} 件`"
        />
        <Cell
          v-if="receipt.u8?.vendor_name"
          title="供应商"
          :note="receipt.u8.vendor_name"
        />
      </div>

      <div class="action-buttons">
        <Button theme="primary" size="large" @click="showWarehousePicker = true">
          选择入库仓库
        </Button>
      </div>
    </div>

    <!-- 状态 3: 输入货架 + 数量 -->
    <div v-if="currentState === 'enter-location' && receipt && selectedWarehouse" class="state-container">
      <div class="receipt-card">
        <div class="receipt-card-title">收货记录</div>
        <Cell
          title="订单号"
          :note="receipt.u8?.order_no || String(receipt.poId)"
        />
        <Cell
          title="物品"
          :note="receipt.u8?.inventory_name || '—'"
        />
        <Cell
          title="采购日期"
          :note="receipt.u8?.purchase_date ? receipt.u8.purchase_date.slice(0, 10) : '—'"
        />
        <Cell
          title="到货日期"
          :note="receipt.u8?.arrive_date ? receipt.u8.arrive_date.slice(0, 10) : '—'"
        />
        <Cell title="本次到货数量" :note="`${receipt.quantity} 件`" />
        <Cell title="已上架 / 剩余" :note="`${putawayQuantity} / ${remainingQuantity} 件`" />
      </div>

      <div class="warehouse-info">
        <Tag theme="primary" variant="light">{{ selectedWarehouse.name }}（{{ selectedWarehouse.code }}）</Tag>
        <Button size="small" variant="outline" @click="pickAgainWarehouse">更换仓库</Button>
      </div>

      <div class="batch-form">
        <div class="form-label">货架号</div>
        <Input v-model="currentLocationCode" placeholder="如 A-01-001" :maxlength="32" />
        <div class="form-label">上架数量</div>
        <Input
          v-model="currentQuantity"
          type="number"
          placeholder="本批次件数"
          :maxlength="6"
        />
        <div class="remaining-hint">剩余可上架：{{ remainingQuantity }} 件</div>
        <Button
          theme="primary"
          size="large"
          block
          :loading="loading"
          @click="confirmBatch"
        >
          添加本批次
        </Button>
      </div>

      <div v-if="pendingBatches.length > 0" class="batch-list">
        <div class="batch-title">本单已添加的批次</div>
        <div v-for="(batch, index) in pendingBatches" :key="index" class="batch-item">
          <Tag>{{ batch.warehouseName }}</Tag>
          <span>{{ batch.locationCode }}</span>
          <span class="qty">{{ batch.quantity }} 件</span>
          <Button size="small" variant="outline" @click="removeBatch(index)">删除</Button>
        </div>
        <div class="batch-summary">
          本次合计 {{ totalBatchedQuantity }} 件；提交后剩余 {{ remainingAfterBatch }} 件
        </div>
      </div>

      <div class="submit-section">
        <Button
          theme="primary"
          size="large"
          block
          :loading="loading"
          :disabled="pendingBatches.length === 0"
          @click="submitPutaway"
        >
          确认入库（{{ totalBatchedQuantity }} 件）
        </Button>
      </div>
    </div>

    <!-- 状态 4: 入库成功 -->
    <div v-if="currentState === 'success'" class="state-container">
      <div class="success-prompt">
        <div class="success-icon">✅</div>
        <h2>入库成功</h2>
        <p>本单已上架 {{ totalBatchedQuantity }} 件；累计 {{ putawayQuantity }} / 订单 {{ receipt?.quantity }} 件</p>
        <Button theme="primary" size="large" block @click="restart">继续入库下一单</Button>
        <Button theme="default" size="large" variant="outline" block @click="goBack">
          返回门户
        </Button>
      </div>
    </div>

    <!-- 仓库选择 Popup -->
    <Popup v-model:visible="showWarehousePicker" placement="bottom" title="选择入库仓库">
      <div class="warehouse-picker">
        <div v-if="warehouses.length === 0" class="empty">暂无仓库数据</div>
        <Radio
          v-for="w in warehouses"
          :key="w.code"
          :checked="selectedWarehouse?.code === w.code"
          @change="chooseWarehouse(w)"
          :label="`${w.name}（${w.code}）${w.person ? ' · ' + w.person : ''}`"
        />
      </div>
    </Popup>
  </div>
</template>

<style scoped>
.storage-putaway {
  min-height: 100vh;
  background: #f5f5f5;
}

.state-container {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scan-prompt {
  text-align: center;
  padding: 60px 20px;
  background: #fff;
  border-radius: 8px;
}

.scan-icon {
  font-size: 80px;
  margin-bottom: 20px;
}

.scan-prompt h2 {
  margin: 0 0 10px;
  font-size: 20px;
}

.scan-prompt p {
  color: #666;
  margin: 0 0 12px;
}

.error-text {
  color: #d63031;
}

.hint-text {
  color: #999;
  font-size: 12px;
}

.receipt-card {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}

.receipt-card-title {
  padding: 12px 16px 8px;
  font-size: 14px;
  color: #888;
  border-bottom: 1px solid #f0f0f0;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.warehouse-info {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border-radius: 8px;
  padding: 12px 16px;
}

.batch-form {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 13px;
  color: #666;
  margin-top: 6px;
}

.remaining-hint {
  font-size: 13px;
  color: #888;
  margin: 4px 0 8px;
}

.batch-list {
  background: #fff;
  border-radius: 8px;
  padding: 12px 16px;
}

.batch-title {
  font-size: 14px;
  color: #666;
  margin-bottom: 8px;
}

.batch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.batch-item:last-child {
  border-bottom: none;
}

.qty {
  font-weight: 500;
}

.batch-summary {
  margin-top: 8px;
  font-size: 13px;
  color: #666;
  text-align: right;
}

.submit-section {
  margin-top: 8px;
}

.success-prompt {
  text-align: center;
  padding: 60px 20px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.success-icon {
  font-size: 80px;
}

.success-prompt h2 {
  margin: 0;
  color: #07c160;
}

.warehouse-picker {
  max-height: 60vh;
  overflow-y: auto;
  padding: 12px 16px;
}

.empty {
  text-align: center;
  color: #999;
  padding: 32px 0;
}
</style>