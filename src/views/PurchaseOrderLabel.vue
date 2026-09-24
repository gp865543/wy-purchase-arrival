<script setup lang="ts">
// 标签 SVG 渲染：克隆 wy-material-print/src/views/MaterialLabel.vue 的 SVG 骨架
// （白底 + 外框 + 多行 text + 右下二维码），字段来自 label.ts 的 labelLines 编译结果。

import { computed } from 'vue';
import { labelLines, labelSize, qrPath } from '../label';
import type { Label } from '../label';
import type { PurchaseOrderDetail } from '../api';
import type { PrinterSettings } from '../printer';

type Props = {
  paper?: PrinterSettings;
  operator?: string;
  operatedAt?: string;
  orderNo: string;
  detail: PurchaseOrderDetail;
  copies: string;
  serial: number;
  printCount?: number;
  planNumber?: string;
  // 分到本张的数量；如果没传则回退到 order detail.quantity
  allocationQuantity?: number;
};

const props = defineProps<Props>();

const layout = computed(() => {
  const l: Label = {
    orderNo: props.orderNo,
    detail: props.detail,
    serial: props.serial,
    copies: props.copies,
    printCount: props.printCount,
    planNumber: props.planNumber,
    allocationQuantity: props.allocationQuantity,
    paper: props.paper,
    operator: props.operator,
    operatedAt: props.operatedAt,
  };
  try { return { lines: labelLines(l), error: '' }; }
  catch (cause) { return { lines: [], error: cause instanceof Error ? cause.message : '标签排版失败' }; }
});
const width = computed(() => labelSize(props.paper).width * 5);
const height = computed(() => labelSize(props.paper).height * 5);
const qr = computed(() => qrPath(String(props.detail.rowId)));
</script>

<template>
  <p v-if="layout.error" role="alert">{{ layout.error }}</p>
  <svg v-else class="purchase-order-label" :viewBox="`-10 -10 ${width + 20} ${height + 20}`" role="img" :aria-label="`${detail.inventoryName} 第 ${serial} 张，共 ${copies} 张`">
    <rect x="-10" y="-10" :width="width + 20" :height="height + 20" fill="white" />
    <rect x="-5" y="-5" :width="width + 10" :height="height + 10" fill="none" stroke="black" stroke-width="1.5" />
    <g fill="black" font-family="sans-serif">
      <text v-for="(line, index) in layout.lines" :key="index" :x="line.x" :text-anchor="line.anchor" :y="line.y" :font-size="line.size" :font-weight="line.size >= 17 ? 'bold' : 'normal'">
        <template v-if="line.underlineStart >= 0"><tspan>{{ line.text.slice(0, line.underlineStart) }}</tspan><tspan text-decoration="underline">{{ line.text.slice(line.underlineStart) }}</tspan></template>
        <template v-else>{{ line.text }}</template>
      </text>
    </g>
    <svg :x="width - 88 + 74 * 4 / qr.size" :y="height - 109" width="74" height="74" :viewBox="`0 0 ${qr.size} ${qr.size}`" role="img" :aria-label="`二维码 ${detail.rowId}`" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="white" /><path :d="qr.path" fill="black" />
    </svg>
  </svg>
</template>

<style scoped>
.purchase-order-label {
  display: block;
  width: 100%;
  max-width: 408px;
  height: auto;
  margin: auto;
}
</style>