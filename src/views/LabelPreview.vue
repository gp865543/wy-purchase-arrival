<script setup lang="ts">
// 临时：标签布局 mock 页面。给开发/设计参考当前 label.ts + PurchaseOrderLabel.vue 的实际渲染。
import PurchaseOrderLabel from './PurchaseOrderLabel.vue';

const samples = [
  {
    title: '案例 1：到货 5 = 拆 4 + 1（剩余）',
    orderNo: '20250217003',
    operator: 'admin',
    operatedAt: '09-24 14:30',
    purchaseDate: '2025-02-15',
    planNumber: '20250914',
    allocationQuantity: 4,
    detail: {
      rowId: 1000010513,
      rowNo: 1,
      inventoryCode: '1030000893',
      inventoryName: '埋夹机配件',
      spec: '',
      quantity: 5,
      unitPrice: 752.212,
      money: 3761.06,
      tax: 488.94,
      sumMoney: 4250,
      arriveDate: '2025-02-17',
      memo: '5  补单  埋夹机',
      validQuantity: null,
      arrivedQuantity: null,
    },
  },
  {
    title: '案例 2：到货 5 = 拆 5 + 1（剩余）',
    orderNo: '20250217003',
    operator: 'admin',
    operatedAt: '09-24 14:31',
    purchaseDate: '2025-02-15',
    planNumber: '0004',
    allocationQuantity: 1,
    detail: {
      rowId: 1000010513,
      rowNo: 1,
      inventoryCode: '1030000893',
      inventoryName: '埋夹机配件',
      spec: '',
      quantity: 5,
      unitPrice: 752.212,
      money: 3761.06,
      tax: 488.94,
      sumMoney: 4250,
      arriveDate: '2025-02-17',
      memo: '',
      validQuantity: null,
      arrivedQuantity: null,
    },
  },
  {
    title: '案例 3：长物料名（看缩字与折行）',
    orderNo: 'PO-2025-Q3-AB-001234',
    operator: '采购员A',
    operatedAt: '09-24 14:32',
    purchaseDate: '2025-02-15',
    planNumber: '20250914',
    allocationQuantity: 5,
    detail: {
      rowId: 1000010515,
      rowNo: 1,
      inventoryCode: '1030000819',
      inventoryName: '超长物料名示例请看缩字效果——埋夹机配件（含护盖）',
      spec: '型号ABC-123 / 通用型',
      quantity: 5,
      unitPrice: 0,
      money: 0,
      tax: 0,
      sumMoney: 0,
      arriveDate: '2025-02-17',
      memo: '',
      validQuantity: null,
      arrivedQuantity: null,
    },
  },
];

const simulatedPaper = {
  language: 'TSPL' as const,
  paperWidth: 76,
  paperHeight: 59,
  mediaType: 'gap' as const,
  gap: 2,
  blackMarkHeight: 0,
  blackMarkOffset: 0,
  x: 0,
  y: 0,
  direction: 0 as const,
  dpi: 300,
};
</script>

<template>
  <div class="label-preview-page">
    <header class="page-header">
      <h1>标签布局预览</h1>
      <p>每个案例 = 一张实际渲染的标签 SVG（同 PrintPreview 中打印的样子）。</p>
    </header>
    <section v-for="(s, idx) in samples" :key="idx" class="sample">
      <h2>{{ s.title }}</h2>
      <div class="layout-grid">
        <PurchaseOrderLabel
          :paper="simulatedPaper"
          :order-no="s.orderNo"
          :detail="s.detail"
          :operator="s.operator"
          :operated-at="s.operatedAt"
          :plan-number="s.planNumber"
          :allocation-quantity="s.allocationQuantity"
          :copies="'1'"
          :serial="1"
          :print-count="idx + 1"
          receipt-id="ec95a789-df4e-4cda-8a91-adc85a06698d"
          :purchase-date="s.purchaseDate"
        />
      </div>
      <pre class="meta">{{ {
        orderNo: s.orderNo,
        purchaseDate: s.purchaseDate,
        planNumber: s.planNumber || '(空)',
        allocationQuantity: s.allocationQuantity,
        detail: { inventoryName: s.detail.inventoryName, spec: s.detail.spec, orderQty: s.detail.quantity, arriveDate: s.detail.arriveDate },
      } }}</pre>
    </section>
  </div>
</template>

<style scoped>
.label-preview-page {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--td-spacer-4) var(--td-spacer-3);
  background: var(--td-bg-color-page);
  font-family: var(--td-font-body-large);
  color: var(--td-text-color-primary);
}
.page-header {
  margin-bottom: var(--td-spacer-4);
}
.page-header h1 {
  font-size: var(--td-font-size-headline-small);
  margin: 0 0 var(--td-spacer-1);
}
.page-header p {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.sample {
  background: var(--td-bg-color-container);
  border-radius: var(--td-radius-large);
  padding: var(--td-spacer-3);
  margin-bottom: var(--td-spacer-4);
  box-shadow: var(--td-shadow-1);
}
.sample h2 {
  margin: 0 0 var(--td-spacer-2);
  font-size: var(--td-font-size-title-small);
}
.layout-grid {
  background: repeating-linear-gradient(
    45deg,
    #f3f3f3,
    #f3f3f3 6px,
    #ffffff 6px,
    #ffffff 12px
  );
  padding: var(--td-spacer-3);
  border-radius: var(--td-radius-default);
}
.meta {
  margin-top: var(--td-spacer-2);
  padding: var(--td-spacer-2);
  background: var(--td-gray-color-1);
  border-radius: var(--td-radius-default);
  font-size: var(--td-font-size-body-small);
  overflow: auto;
}
</style>