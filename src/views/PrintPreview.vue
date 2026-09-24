<script setup lang="ts">
// 克隆 wy-material-print/src/views/PrintPreview.vue 的完整工程结构（Dialog + 蓝牙 + 进度
// Popup + 模拟入口 + 真实打印链路）。业务字段映射：plan→order, materials→details,
// preparations→selected rows + copies。骨架阶段完成 Issue #2/#3 后接通 Issue #4：
// createPrintOperation（拿 operationId）+ sendStoredLabels（按 rowId 编译 + 推送）
// + savePrintResult（写回 page 状态）。

import { computed, onMounted, onUnmounted, ref } from 'vue';
import BluetoothIcon from 'tdesign-icons-vue-next/esm/components/bluetooth';
import CloseIcon from 'tdesign-icons-vue-next/esm/components/close';
import PrintIcon from 'tdesign-icons-vue-next/esm/components/print';
import { Button, Dialog, Loading, Popup, Toast } from 'tdesign-mobile-vue';
import { createPrintOperation, getPrintCounts, getOperatorName, savePrintResult, type Allocation, type PrintResult, type PrintOperation, type PurchaseOrder, type PurchaseOrderDetail } from '../api';
import PurchaseOrderLabel from './PurchaseOrderLabel.vue';
import { compileLabel, labelSize } from '../label';
import { storedLabel } from '../pcx';
import { deviceSnapshot, printer, sendStoredLabels, type DeviceSnapshot } from '../printer';
import { usePageBack } from '../pageBack';
import BluetoothConnection from './BluetoothConnection.vue';

const props = defineProps<{ order: PurchaseOrder; details: PurchaseOrderDetail[]; counts?: Record<number, number>; allocations?: Allocation[]; simulate?: boolean }>();
const operator = getOperatorName();
const SIMULATED_DEVICE: DeviceSnapshot = { deviceId: 'SIMULATED', settings: { language: 'TSPL', paperWidth: 76, paperHeight: 59, mediaType: 'gap', gap: 2, blackMarkHeight: 0, blackMarkOffset: 0, x: 0, y: 0, direction: 0, dpi: 300 } };
const operatedAt = ref(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(5, 16));
const bluetooth = ref(false), busy = ref(false), unsaved = ref(false);
const error = ref('');
const stage = ref('');
const progressOpen = ref(false);
const batchNotice = ref('');
const device = ref<DeviceSnapshot | undefined>(props.simulate ? SIMULATED_DEVICE : undefined);
const readingSettings = ref(false);
const ready = computed(() => props.simulate ? !!device.value : connected.value && !!device.value && device.value.deviceId.toUpperCase() === printer.value?.connection.device?.deviceId.toUpperCase());
const operation = ref<PrintOperation>();
const result = ref<PrintResult>();
const connected = computed(() => printer.value?.connection?.code === 0);
const locked = computed(() => busy.value || unsaved.value);
const emit = defineEmits<{ back: [] }>();
const back = usePageBack('preview', () => emit('back'), () => !locked.value && !progressOpen.value);

// 每条 allocation → 1 张标签（含"剩余"行）。一条明细 N 个分配 = N 张标签。
// printCopies 已删除：分配行数 = 标签数。
const items = computed(() => {
  const out: Array<{
    rowId: number;
    detail: PurchaseOrderDetail;
    planNumber: string;
    quantity: number;
    copies: number;
    isResidual: boolean;
    serial: number;
    receiptId?: string;
  }> = [];
  let serial = 1;
  for (const alloc of props.allocations ?? []) {
    const detail = props.details.find(d => d.rowId === alloc.rowId);
    if (!detail) continue;
    out.push({
      rowId: alloc.rowId,
      detail,
      planNumber: alloc.planNumber,
      quantity: alloc.quantity,
      copies: 1,
      isResidual: alloc.planNumber === '' || alloc.planNumber === '剩余',
      serial: serial++,
      receiptId: alloc.receiptId,
    });
  }
  return out;
});
const total = computed(() => items.value.length);
const pages = computed(() => items.value.slice(0, limit.value));
const limit = ref(20);
function loadMore(event: Event) {
  const body = event.currentTarget as HTMLElement;
  if (body.scrollHeight - body.scrollTop - body.clientHeight < 160) limit.value += 20;
}
function closeProgress() {
  if (busy.value) return;
  progressOpen.value = false;
  if (!error.value && !unsaved.value) back();
}
async function persist() {
  if (!operation.value || !result.value) return;
  await savePrintResult(operation.value.id, result.value);
  unsaved.value = false;
}
function finishSimulate() {
  busy.value = false;
  closeProgress();
  Toast({ message: '模拟打印完毕', theme: 'success', duration: 1500, preventScrollThrough: false });
}
async function print() {
  if (busy.value || !ready.value || readingSettings.value) return;
  busy.value = true; progressOpen.value = true; batchNotice.value = ''; error.value = ''; stage.value = '生成打印数据...';
  try {
    const snapshot = device.value!;
    labelSize(snapshot.settings);

    // Step 1: create the immutable snapshot on the backend. The backend reads U8
    // and stores header + selected detail lines so a later review sees what was
    // 创建后端 operation：每条 allocation = 后端 1 张标签，所以 copies 字段固定传 1。
    // 后端快照里的 "copies" 仍然是该 row 的标签总数（所有 allocation 行）。
    const created = await createPrintOperation(
      props.order.poId,
      // 后端 items 的 copies = 该 row 下有多少分配行（每行 = 1 张标签）
      (() => {
        const counts = new Map<number, number>();
        for (const alloc of props.allocations ?? []) {
          counts.set(alloc.rowId, (counts.get(alloc.rowId) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([rowId, copies]) => ({ rowId, copies }));
      })(),
      props.allocations ?? [],
    );
    operation.value = created;
    operatedAt.value = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(5, 16);
    result.value = {
      device: snapshot,
      // 每条 allocation = 1 张标签；序号按 details.displayOrder 走（已在 items 序列里）
      pages: items.value.map(item => ({
        rowId: item.rowId,
        serial: item.serial,
        status: 'pending' as const,
        error: '',
      })),
    };
    unsaved.value = true;

    if (props.simulate) {
      result.value.pages.forEach(page => { page.status = 'sent'; });
      await persist();
      finishSimulate();
      return;
    }

    // Step 2: compile TSPL/PCX labels and push to the printer. sendStoredLabels
    // batches by printer free-bytes, writes via the K329 printer.printTspl
    // shell bridge, and surfaces per-batch sent/error states.
    try {
      // 每条 allocation = 1 张标签；用本地 props.allocations 编译，因为 created.items 的
      // material 字段不带 planNumber（后端只持久化 inventory 元数据）。
      const compiledBatches = items.value.map(item => ({
        rowId: item.rowId,
        serial: item.serial,
        commands: [compileLabel(snapshot.settings, {
          orderNo: props.order.orderNo,
          detail: item.detail,
          serial: item.serial,
          copies: '1',
          planNumber: item.planNumber,
          printCount: (props.counts?.[item.rowId] ?? 0) + 1,
          operator,
          operatedAt: operatedAt.value,
          // 多带一个 quantity 给 label.ts 用作"分配数量"
          allocationQuantity: item.quantity,
        })],
      }));
      const pictures = compiledBatches.flatMap(b => b.commands.map(command => storedLabel(command, Number(snapshot.settings.dpi))));
      await sendStoredLabels(snapshot, pictures, (start, count, sendErr) => {
        // pictures 索引对应 compiledBatches 顺序；每个 batch = 1 张标签。
        for (let i = 0; i < count; i++) {
          const batchIndex = start + i;
          const batch = compiledBatches[batchIndex];
          if (!batch) continue;
          const page = result.value!.pages.find(p => p.rowId === batch.rowId && p.serial === batch.serial);
          if (page) {
            page.status = sendErr ? 'error' : 'sent';
            page.error = sendErr?.message ?? '';
          }
        }
      }, message => { stage.value = message; }, () => { batchNotice.value = '打印尚未完成，请继续等待'; });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '打印失败';
      if (!result.value.pages.some(page => page.status === 'error')) {
        const pending = result.value.pages.find(page => page.status === 'pending');
        if (pending) { pending.status = 'error'; pending.error = error.value; }
      }
    }
    await persist();
    if (!error.value) stage.value = '打印完成，请核对出纸';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '打印失败，请重试'; }
  finally { busy.value = false; batchNotice.value = ''; }
}
function leave(event: BeforeUnloadEvent) { if (locked.value) { event.preventDefault(); event.returnValue = ''; } }
async function refreshConnection() {
  if (document.visibilityState !== 'visible' || busy.value || readingSettings.value) return;
  readingSettings.value = true;
  device.value = undefined;
  error.value = '';
  try {
    const snapshot = await deviceSnapshot().catch(() => undefined);
    if (snapshot) { labelSize(snapshot.settings); device.value = snapshot; }
  } catch (cause) { if (connected.value) error.value = cause instanceof Error ? cause.message : '设备参数读取失败'; }
  finally { readingSettings.value = false; }
}
function closeBluetooth() { bluetooth.value = false; refreshConnection(); }
onMounted(() => {
  window.addEventListener('beforeunload', leave);
  if (props.simulate) return;
  document.addEventListener('visibilitychange', refreshConnection);
  refreshConnection();
});
onUnmounted(() => { window.removeEventListener('beforeunload', leave); document.removeEventListener('visibilitychange', refreshConnection); });
</script>

<template>
  <Dialog style="--td-dialog-body-max-height: none" :z-index="1500" :visible="!bluetooth" width="calc(100vw - 24px)" @close="back">
    <template #actions>
      <div class="preview-actions">
        <Button theme="light" size="small" :disabled="locked" @click="back"><template #icon><CloseIcon aria-hidden="true" /></template>关闭</Button>
        <Button v-if="simulate" theme="primary" size="small" :loading="busy" :disabled="busy || !ready" @click="print"><template #icon><PrintIcon aria-hidden="true" /></template>{{ unsaved && !busy ? '重试保存' : '模拟打印' }}</Button>
        <template v-else>
          <Button theme="light" size="small" :class="{ connected }" :disabled="busy" @click="bluetooth = true"><template #icon><BluetoothIcon aria-hidden="true" /></template>蓝牙</Button>
          <Button theme="primary" size="small" :loading="busy" :disabled="busy || readingSettings || !ready" @click="print"><template #icon><PrintIcon aria-hidden="true" /></template>{{ unsaved && !busy ? '重试保存' : '打印标签' }}</Button>
        </template>
      </div>
    </template>
    <p v-if="error && !progressOpen" role="alert">{{ error }}</p>
    <p class="preview-total">{{ total }} 张标签</p>
    <p v-if="simulate" class="preview-simulate">模拟打印 · 不向打印机发送数据</p>
    <p v-if="readingSettings">正在读取标签尺寸…</p>
    <p v-else-if="!device && !error">请连接打印机以预览标签</p>
    <div v-if="device" class="label-pages" @scroll.passive="loadMore">
      <figure v-for="page in pages" :key="`${page.rowId}-${page.serial}`" class="paper-panel">
        <PurchaseOrderLabel :paper="device.settings" :operator="operator" :operated-at="operatedAt" :order-no="order.orderNo" :detail="page.detail" :copies="'1'" :serial="page.serial" :plan-number="page.planNumber" :allocation-quantity="page.quantity" :receipt-id="page.receiptId" :print-count="counts ? (counts[page.rowId] ?? 0) + 1 : undefined" />
      </figure>
    </div>
  </Dialog>
  <Popup :visible="progressOpen" placement="center" :close-on-overlay-click="false" :z-index="1600" :overlay-props="{ zIndex: 1599 }">
    <section class="print-progress" role="dialog" aria-modal="true" aria-label="打印进度">
      <div role="status" aria-live="polite">
        <div v-if="!error" class="print-stage"><Loading v-if="busy" size="32px" /><span>{{ stage }}</span></div>
        <p v-if="batchNotice">{{ batchNotice }}</p>
        <p v-if="!busy && result">已打印 {{ result.pages.some(page => page.status === 'sent') ? `1-${result.pages.filter(page => page.status === 'sent').length}` : '0' }}</p>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <Button v-if="!busy" block theme="primary" @click="closeProgress">关闭</Button>
    </section>
  </Popup>
  <BluetoothConnection v-if="bluetooth" @back="closeBluetooth" />
</template>

<style scoped>
.print-progress { box-sizing: border-box; width: calc(100vw - 48px); max-width: 360px; padding: var(--td-spacer-3); text-align: center; background: var(--td-bg-color-container); border-radius: var(--td-radius-large); font: var(--td-font-body-large); }
.print-stage { display: flex; align-items: center; justify-content: center; gap: var(--td-spacer-2); margin: var(--td-spacer-2) 0; }
.print-stage > .t-loading { flex-shrink: 0; }
.print-progress p { margin: var(--td-spacer-2) 0; }
.preview-actions { display: flex; gap: var(--td-spacer-1); width: 100%; }
.preview-actions > * { flex: 1; height: 44px; padding: 0 4px; white-space: nowrap; }
.preview-actions > :last-child { flex: 1.4; }
.preview-actions > .connected { color: var(--td-success-color); }
.label-pages { max-height: 60vh; overflow: auto; overscroll-behavior: contain; color: var(--td-text-color-primary); }
.preview-total { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0 0 var(--td-spacer-2); font: var(--td-font-body-medium); }
.preview-simulate { margin: 0 0 var(--td-spacer-2); padding: var(--td-spacer-1); text-align: center; color: var(--td-brand-color); background: var(--td-brand-color-1); border-radius: var(--td-radius-default); font: var(--td-font-body-small); }
.paper-panel { margin: 0 0 var(--td-spacer-2); }
.paper-panel:last-child { margin-bottom: 0; }
</style>