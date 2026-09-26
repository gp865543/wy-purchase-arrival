<script setup lang="ts">
/**
 * StoragePutaway.vue - 采购入库扫码页面
 *
 * Issue #72 (2026-09-26): PDA 采购入库 - 扫码 UI
 *
 * 业务流程：
 * 1. 扫采购收货标签二维码，获取收货记录信息
 * 2. 扫货位二维码，选择上架货位
 * 3. 填写上架数量
 * 4. 重复步骤 2-3 直到全部上架完成
 * 5. 提交入库
 *
 * 特殊情况：直接拉到车间的货，入线边仓
 */

import { onMounted, ref } from 'vue';
import { Button, Cell, Input, Navbar, Popup, Radio, Tag, Toast } from 'tdesign-mobile-vue';
import { createPutaway, listStorageLocations, type StorageLocation } from '../api';
import { leaveToPortal } from '../portal';

// 当前页面状态
type PageState = 'scan-receipt' | 'enter-quantity' | 'scan-location' | 'confirm' | 'success';

const currentState = ref<PageState>('scan-receipt');

// 收货记录信息（从二维码解析）
const receiptInfo = ref<{
  receiptId: string;
  poId: number;
  orderNo: string;
  vendorName: string;
  totalQuantity: number;
  putawayQuantity: number;
} | null>(null);

// 已扫描的货位
const selectedLocation = ref<StorageLocation | null>(null);

// 上架数量
const putawayQuantity = ref<number>(0);

// 当前批次记录（一个收货单可能分多次上架）
const putawayBatch = ref<{
  locationCode: string;
  locationName: string;
  quantity: number;
  isLineSide: boolean;
}[]>([]);

// 货位列表
const locations = ref<StorageLocation[]>([]);

// 货位键盘
const showLocationPicker = ref(false);
const showKeyboard = ref(false);
const keyboardValue = ref('');

// 加载状态
const loading = ref(false);
const error = ref('');

// 初始化页面
onMounted(async () => {
  await loadLocations();
});

// 加载货位列表
async function loadLocations() {
  try {
    locations.value = await listStorageLocations();
  } catch (e) {
    console.error('加载货位列表失败:', e);
  }
}

// 模拟扫码收货二维码
function simulateScanReceipt() {
  // 模拟扫码结果
  receiptInfo.value = {
    receiptId: 'RCP-' + Date.now(),
    poId: 12345,
    orderNo: 'PO-2024-001',
    vendorName: '测试供应商',
    totalQuantity: 100,
    putawayQuantity: 0,
  };

  currentState.value = 'scan-location';
  Toast({ message: '收货记录已扫描', theme: 'success', preventScrollThrough: false });
}

// 模拟扫码货位二维码
function simulateScanLocation() {
  // 模拟扫码结果
  const locationCode = 'A-01-' + String(Math.floor(Math.random() * 999)).padStart(3, '0');
  selectedLocation.value = {
    id: '',
    code: locationCode,
    name: '仓库 ' + locationCode,
    locationType: 'warehouse',
    isDefault: false,
    departmentCode: null,
  };

  currentState.value = 'enter-quantity';
  Toast({ message: '货位已扫描', theme: 'success' });
}

// 输入上架数量
function handleQuantityInput(value: string) {
  const num = parseInt(value, 10);
  if (!isNaN(num) && num > 0) {
    putawayQuantity.value = num;
  }
}

// 确认当前批次
function confirmBatch() {
  if (!selectedLocation.value || putawayQuantity.value <= 0) {
    Toast({ message: '请填写正确的上架数量', theme: 'warning' });
    return;
  }

  const remaining = getRemainingQuantity();
  if (putawayQuantity.value > remaining) {
    Toast({ message: `剩余可上架数量为 ${remaining}`, theme: 'warning' });
    return;
  }

  putawayBatch.value.push({
    locationCode: selectedLocation.value.code,
    locationName: selectedLocation.value.name,
    quantity: putawayQuantity.value,
    isLineSide: selectedLocation.value.locationType === 'line_side',
  });

  // 重置状态
  selectedLocation.value = null;
  putawayQuantity.value = 0;
  currentState.value = 'scan-location';
  Toast({ message: '已添加上架批次', theme: 'success' });
}

// 获取剩余可上架数量
function getRemainingQuantity(): number {
  if (!receiptInfo.value) return 0;
  const total = receiptInfo.value.totalQuantity || 0;
  const alreadyPutaway = putawayBatch.value.reduce((sum, b) => sum + b.quantity, 0);
  return total - alreadyPutaway;
}

// 删除一个批次
function removeBatch(index: number) {
  putawayBatch.value.splice(index, 1);
}

// 提交全部入库
async function submitPutaway() {
  if (putawayBatch.value.length === 0) {
    Toast({ message: '请先添加上架记录', theme: 'warning' });
    return;
  }

  if (!receiptInfo.value) {
    Toast({ message: '缺少收货记录信息', theme: 'error' });
    return;
  }

  loading.value = true;
  error.value = '';

  try {
    for (const batch of putawayBatch.value) {
      await createPutaway({
        receiptId: receiptInfo.value.receiptId,
        locationCode: batch.locationCode,
        quantity: batch.quantity,
        isLineSide: batch.isLineSide,
      });
    }

    currentState.value = 'success';
    Toast({ message: '入库成功', theme: 'success' });
  } catch (e) {
    console.error('入库失败:', e);
    error.value = e instanceof Error ? e.message : '入库失败，请重试';
    Toast({ message: error.value, theme: 'error' });
  } finally {
    loading.value = false;
  }
}

// 返回门户
function goBack() {
  leaveToPortal();
}

// 重新开始
function restart() {
  receiptInfo.value = null;
  selectedLocation.value = null;
  putawayQuantity.value = 0;
  putawayBatch.value = [];
  currentState.value = 'scan-receipt';
  error.value = '';
}

// 选择货位
function selectLocation(location: StorageLocation) {
  selectedLocation.value = location;
  showLocationPicker.value = false;
  currentState.value = 'enter-quantity';
}

// 选择线边仓
function selectLineSide() {
  const lineSide = locations.value.find(l => l.locationType === 'line_side');
  if (lineSide) {
    selectedLocation.value = lineSide;
    showLocationPicker.value = false;
    currentState.value = 'enter-quantity';
    Toast({ message: '已选择线边仓', theme: 'success' });
  } else {
    Toast({ message: '未配置线边仓，请联系管理员', theme: 'warning' });
  }
}
</script>

<template>
  <div class="storage-putaway">
    <!-- 顶部导航 -->
    <Navbar title="采购入库" left-icon="back" @click-left="goBack" />

    <!-- 状态1: 扫描收货二维码 -->
    <div v-if="currentState === 'scan-receipt'" class="state-container">
      <div class="scan-prompt">
        <div class="scan-icon">📦</div>
        <h2>扫描收货标签</h2>
        <p>请扫描采购收货单上的二维码</p>
        <!-- 模拟扫码按钮（实际使用时替换为真实扫码） -->
        <Button theme="primary" size="large" @click="simulateScanReceipt">
          模拟扫描收货二维码
        </Button>
      </div>
    </div>

    <!-- 状态2: 扫描货位 -->
    <div v-if="currentState === 'scan-location'" class="state-container">
      <!-- 收货信息摘要 -->
      <div v-if="receiptInfo" class="receipt-summary">
        <Cell title="收货单号" :content="receiptInfo.receiptId.substring(0, 8) + '...'" />
        <Cell title="待上架" :content="`${getRemainingQuantity()} 件`" />
        <Cell v-if="putawayBatch.length > 0" title="已上架" :content="`${putawayBatch.reduce((s, b) => s + b.quantity, 0)} 件`" />
      </div>

      <!-- 已添加的批次 -->
      <div v-if="putawayBatch.length > 0" class="batch-list">
        <div class="batch-title">已添加批次</div>
        <div v-for="(batch, index) in putawayBatch" :key="index" class="batch-item">
          <Tag>{{ batch.locationName }}</Tag>
          <span>{{ batch.quantity }} 件</span>
          <Button size="small" variant="outline" @click="removeBatch(index)">删除</Button>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <!-- 模拟扫码按钮（实际使用时替换为真实扫码） -->
        <Button theme="primary" size="large" @click="simulateScanLocation">
          模拟扫描货位二维码
        </Button>
        <Button theme="default" size="large" variant="outline" @click="showLocationPicker = true">
          从列表选择货位
        </Button>
        <Button theme="danger" size="large" variant="outline" @click="selectLineSide">
          线边仓快捷入口
        </Button>
      </div>

      <!-- 提交按钮 -->
      <div v-if="putawayBatch.length > 0" class="submit-section">
        <Button theme="primary" size="large" block :loading="loading" @click="submitPutaway">
          确认入库 ({{ putawayBatch.reduce((s, b) => s + b.quantity, 0) }} 件)
        </Button>
      </div>
    </div>

    <!-- 状态3: 输入数量 -->
    <div v-if="currentState === 'enter-quantity'" class="state-container">
      <div class="location-info">
        <Tag v-if="selectedLocation?.locationType === 'line_side'" variant="light" theme="danger">线边仓</Tag>
        <h3>{{ selectedLocation?.name || selectedLocation?.code }}</h3>
        <p class="location-code">{{ selectedLocation?.code }}</p>
      </div>

      <div class="quantity-input">
        <div class="remaining">剩余可上架: {{ getRemainingQuantity() }} 件</div>
        <Input
          v-model="putawayQuantity"
          type="number"
          placeholder="请输入上架数量"
          :maxlength="6"
        />
      </div>

      <div class="action-buttons">
        <Button theme="primary" size="large" block @click="showKeyboard = true">
          数字键盘输入
        </Button>
        <Button theme="primary" size="large" :disabled="putawayQuantity <= 0" @click="confirmBatch">
          确认此批次
        </Button>
        <Button theme="default" size="large" variant="outline" @click="currentState = 'scan-location'">
          返回
        </Button>
      </div>
    </div>

    <!-- 状态4: 成功 -->
    <div v-if="currentState === 'success'" class="state-container">
      <div class="success-prompt">
        <div class="success-icon">✅</div>
        <h2>入库成功</h2>
        <p>已成功入库 {{ putawayBatch.reduce((s, b) => s + b.quantity, 0) }} 件</p>

        <div class="batch-summary">
          <div v-for="(batch, index) in putawayBatch" :key="index" class="summary-item">
            {{ batch.locationName }}: {{ batch.quantity }} 件
          </div>
        </div>

        <Button theme="primary" size="large" block @click="restart">
          继续入库
        </Button>
        <Button theme="default" size="large" variant="outline" @click="goBack">
          返回门户
        </Button>
      </div>
    </div>

    <!-- 货位选择弹窗 -->
    <Popup v-model:visible="showLocationPicker" title="选择货位" placement="bottom">
      <div class="location-picker">
        <div
          v-for="location in locations"
          :key="location.id"
          class="location-item"
          @click="selectLocation(location)"
        >
          <div class="location-name">{{ location.name }}</div>
          <div class="location-code">{{ location.code }}</div>
          <Tag v-if="location.locationType === 'line_side'" variant="light" theme="danger">线边仓</Tag>
        </div>
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
}

.scan-prompt {
  text-align: center;
  padding: 60px 20px;
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
  margin: 0 0 30px;
}

.receipt-summary {
  background: #fff;
  border-radius: 8px;
  margin-bottom: 16px;
}

.batch-list {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
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
  border-bottom: 1px solid #eee;
}

.batch-item:last-child {
  border-bottom: none;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.submit-section {
  margin-top: 24px;
}

.location-info {
  text-align: center;
  padding: 30px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 16px;
}

.location-info h3 {
  margin: 10px 0 5px;
}

.location-code {
  color: #666;
  font-size: 14px;
}

.quantity-input {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.remaining {
  color: #666;
  margin-bottom: 10px;
}

.success-prompt {
  text-align: center;
  padding: 60px 20px;
}

.success-icon {
  font-size: 80px;
  margin-bottom: 20px;
}

.success-prompt h2 {
  margin: 0 0 10px;
  color: #07c160;
}

.batch-summary {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 16px;
  margin: 20px 0;
  text-align: left;
}

.summary-item {
  padding: 4px 0;
}

.location-picker {
  max-height: 60vh;
  overflow-y: auto;
  padding: 16px;
}

.location-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.location-item:active {
  background: #e5e5e5;
}

.location-name {
  flex: 1;
  font-weight: 500;
}

.location-code {
  color: #666;
  font-size: 14px;
}
</style>
