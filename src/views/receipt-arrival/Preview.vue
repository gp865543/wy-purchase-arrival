<script setup lang="ts">
/**
 * 收货记录预览：以 t-dialog 模态形式覆盖在 Receipt 上层，与 wy-customer-material-receipt 的
 * receipt/Preview.vue 形态一致 — 单击"打印贴签"打开，关闭按钮退出。
 *
 * 行为对齐：
 *   - label 卡片：订单号 / 供应商 / 物料 / 规格 / 数量 / QR / 操作员·时间
 *   - 打印份数 stepper
 *   - 三个底栏按钮：关闭 / 连接蓝牙 / 打印贴签
 *
 * 业务差异：采购收货业务不走"贴签贴袋子"流程，"打印贴签"按钮仍保留 UI 占位，
 * 点按时若未连蓝牙提示"请先连接蓝牙"；连上时透传到 printer API。
 */
import { computed, onUnmounted, ref } from 'vue';
import { Loading, Stepper, Toast } from 'tdesign-mobile-vue';
import QRCode from 'qrcode';

import {
  ensureOperatorName,
  getReceiptWithDetail,
  type ReceiptWithDetail,
} from '../../api';
import { requestPrinter } from '../../printer';

const props = defineProps<{
  recordId: string;
}>();
const emit = defineEmits<{ close: [] }>();

const preview = ref<ReceiptWithDetail>();
const qr = ref('');
const loading = ref(false);
const error = ref('');
const operator = ref('');
const copies = ref('1');
const busy = ref(false);
const message = ref('');

let controller: AbortController | undefined;

async function load() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  loading.value = true;
  error.value = '';
  preview.value = undefined;
  try {
    const result = await getReceiptWithDetail(props.recordId, request.signal);
    if (request.signal.aborted) return;
    preview.value = result;
    operator.value = (await ensureOperatorName(request.signal)) || '操作员';
    qr.value = await QRCode.toDataURL(result.receiptId, { margin: 0, scale: 4 });
  } catch (cause) {
    if (!request.signal.aborted)
      error.value = cause instanceof Error ? cause.message : '预览读取失败，请重试';
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}
void load();
onUnmounted(() => controller?.abort());

const count = computed(() =>
  /^[0-9]+$/.test(copies.value) &&
  Number(copies.value) >= 1 &&
  Number(copies.value) <= 10_000
    ? Number(copies.value)
    : 0,
);

function formatTime(ts: string): string {
  return ts
    ? new Date(ts).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    : '';
}

async function connectBluetooth() {
  busy.value = true;
  message.value = '';
  try {
    await requestPrinter('shell.openBluetoothPage');
    message.value = '蓝牙页面已打开';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '蓝牙连接失败';
  } finally {
    busy.value = false;
  }
}

async function print() {
  if (!preview.value) return;
  if (!count.value) {
    error.value = '请输入 1 至 10000 的整数份数';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    // 采购收货业务下"打印贴签"为可选 UI 占位：先尝试调打印机 API，
    // 未连接 / 设备不支持时给出明确提示。
    await requestPrinter('printer.printTspl', {
      receiptId: preview.value.receiptId,
      copies: count.value,
    });
    Toast({ message: '已发送打印任务', theme: 'success' });
    emit('close');
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : '打印失败';
    if (text.includes('请在 PDA 应用内连接打印机') || text.includes('未连接')) {
      error.value = '请先连接蓝牙';
    } else {
      error.value = text;
    }
  } finally {
    busy.value = false;
  }
}

</script>

<template>
  <t-dialog
    visible
    width="calc(100vw - 24px)"
    :z-index="1500"
    :close-on-overlay-click="false"
    :close-btn="false"
  >
    <div class="print-preview-content" :aria-busy="loading">
      <div v-if="loading && !preview" class="center" role="status">
        <Loading :loading="loading" :delay="300" text="加载中…" />
      </div>
      <template v-if="preview">
        <figure class="garment-label">
          <div class="label-info">
            <strong>{{ preview.u8?.order_no || '—' }}</strong>
            <span>{{ preview.u8?.vendor_name || '—' }}</span>
            <strong>{{ preview.u8?.inventory_name || '—' }}</strong>
            <span>{{ preview.u8?.spec || '—' }}</span>
          </div>
          <strong class="label-quantity"
            >到货数量：{{ preview.quantity }}</strong
          >
          <div class="label-code">
            <img :src="qr" :alt="`收货记录 ${preview.receiptId} 二维码`" />
          </div>
          <div class="label-bottom">
            <span>{{ operator }}</span>
            <span class="label-serial">1 / {{ count || 1 }}</span>
            <span>{{ formatTime(preview.createdAt) }}</span>
          </div>
        </figure>
        <div class="copies-row">
          <label id="copies-label">打印份数</label>
          <Stepper
            class="print-copies"
            v-model="copies"
            :disabled="busy"
            :min="1"
            :max="10000"
            integer
            aria-labelledby="copies-label"
          />
        </div>
      </template>
      <div v-if="message" role="status" aria-live="polite">
        <p>{{ message }}</p>
      </div>
      <div v-if="error" role="alert">
        <p class="error">{{ error }}</p>
        <t-button v-if="!preview" variant="outline" @click="load">重试</t-button>
      </div>
    </div>
    <template #actions>
      <div class="preview-actions">
        <t-button variant="outline" :disabled="busy" @click="emit('close')">
          关闭
        </t-button>
        <t-button variant="outline" :disabled="busy" @click="connectBluetooth">
          连接蓝牙
        </t-button>
        <t-button
          theme="primary"
          :disabled="busy || !preview || !count"
          @click="print"
        >
          打印贴签
        </t-button>
      </div>
    </template>
  </t-dialog>
</template>

<style scoped>
.garment-label {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px;
  gap: var(--td-spacer-1);
  align-items: end;
  padding: var(--td-spacer-2);
  margin: var(--td-spacer-2) 0;
  font-size: var(--td-font-size-body-medium);
  color: var(--td-text-color-primary);
  text-align: left;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
}

.label-quantity {
  line-height: 1;
  overflow-wrap: anywhere;
}

.label-info {
  display: flex;
  flex-direction: column;
  grid-column: 1 / -1;
  gap: var(--td-spacer-1);
  overflow-wrap: anywhere;
}

.label-code {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 80px;
}

.label-code img {
  width: 80px;
  height: 80px;
}

.label-bottom {
  position: relative;
  display: flex;
  grid-column: 1 / -1;
  gap: var(--td-spacer-1);
  justify-content: space-between;
  width: 100%;
}

.label-serial {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.copies-row {
  display: flex;
  gap: var(--td-spacer-2);
  align-items: center;
  justify-content: space-between;
}

.print-copies {
  height: 36px;
  font-size: var(--td-font-size-body-large);
}

.print-copies :deep(.t-stepper__minus),
.print-copies :deep(.t-stepper__plus) {
  width: 44px;
  height: 36px;
  font-size: 24px;
}

.print-copies :deep(.t-stepper__input) {
  width: 52px;
  height: 36px;
}

.print-preview-content {
  max-height: calc(100dvh - 160px);
  overflow-y: auto;
}

.preview-actions {
  display: flex;
  gap: var(--td-spacer-1);
  width: 100%;
}

.preview-actions > * {
  flex: 1;
}

.error {
  color: var(--td-error-color);
}

.center {
  text-align: center;
}
</style>
