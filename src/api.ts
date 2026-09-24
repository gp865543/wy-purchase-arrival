// 业务接口骨架。
//
// 当前文件只定义"路径约定 + 类型契约 + 路由占位"，调用形态（AbortSignal / 401 跳登录 / CSRF 写入）
// 克隆自 wy-material-print/src/api.ts，业务端点改为采购到货收货专用路径。
//
// 后端在 wy-fastapi/portal_identity/purchase_arrival.py 落地前，本文件返回的 Promise 永远不会被
// 真实解析；前端只走骨架视图。完整业务实现列入 ADR0011 与后续 Issue。

const apiBase = (import.meta.env.VITE_API_BASE || '/api/v1').replace(/\/$/, '');

let operatorName = '';
export const getOperatorName = () => operatorName;

// 采购订单主表行（来自 U8 PO_POMain，与 wy-portal web-antdv-next 桌面端的契约一致；
// 移动端只需要更少字段，列出清单页面用得到的）。
export type PurchaseOrder = {
  poId: number;
  orderNo: string;
  orderDate: string;
  vendorCode: string;
  vendorName: string;
  departmentCode: string;
  departmentName: string;
  personCode: string;
  state: 0 | 1 | 2; // 0 未审核 / 1 已审核 / 2 已关闭，与 wy-fastapi PO_STATE_LABELS 对齐
  cost: number;
  bargain: number;
  memo: string;
};

// 采购订单明细行（来自 U8 PO_PODetails）。
// 标签字段使用订单数量（quantity），不再单独录入"实收数量"。
export type PurchaseOrderDetail = {
  rowId: number;            // U8 PO_PODetails.ID（标签二维码内容）
  rowNo: number;            // ivouchrowno
  inventoryCode: string;    // cInvCode
  inventoryName: string;    // cInvName
  spec: string;             // cInvStd
  quantity: number;         // iQuantity（订单数量，标签主用）
  unitPrice: number;
  money: number;
  tax: number;
  sumMoney: number;
  arriveDate: string | null;
  memo: string;
};

// 标签预览（移动端无"实发数量"录入，按订单数量直接进入打印）。
export type LabelPreview = {
  detailRowId: number;
  copies: number;
};

export type PrintOperation = {
  id: string;
  poId: number;
  orderNo: string;
  printedBy: string;
  createdAt: string;
  items: {
    rowId: number;
    material: PurchaseOrderDetail;
    copies: number;
    printCount: number;
  }[];
};

export type PrintResult = {
  device: import('./printer').DeviceSnapshot;
  pages: { rowId: number; serial: number; status: 'pending' | 'sent' | 'error'; error: string }[];
};

function login() {
  const url = new URL(import.meta.env.VITE_PORTAL_LOGIN || (import.meta.env.DEV ? '/auth/login' : '/#/auth/login'), location.href);
  if (import.meta.env.DEV && !import.meta.env.VITE_PORTAL_LOGIN) url.port = '16001';
  const returnTo = location.pathname + location.search + location.hash;
  if (url.hash) url.hash += `${url.hash.includes('?') ? '&' : '?'}${new URLSearchParams({ return_to: returnTo })}`;
  else url.searchParams.set('return_to', returnTo);
  location.assign(url.href);
}

async function get(path: string, signal: AbortSignal, error = '采购订单读取失败，请重试') {
  const response = await fetch(`${apiBase}${path}`, { credentials: 'same-origin', signal });
  if (response.status === 401) { login(); throw new Error('登录已失效，请重新登录'); }
  if (!response.ok) throw new Error(error);
  return response.json();
}

async function write(path: string, method: string, body: object) {
  const { csrfToken } = await get('/auth/csrf', new AbortController().signal, '会话校验失败，请重试');
  const response = await fetch(`${apiBase}${path}`, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Portal-Request': '1', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  });
  if (response.status === 401) login();
  if (!response.ok) throw new Error('保存失败，请检查数据后重试');
  return response.json();
}

// ----- 列表 / 详情 -----

// 已审核采购订单列表（state=1 硬过滤，后端 purchase_arrival.py）。
// 后端实现：wy-fastapi/portal_identity/purchase_arrival.py，挂在 /api/v1/purchase-arrival/。
export function listPurchaseOrders(keyword: string, page: number, signal: AbortSignal): Promise<{
  items: PurchaseOrder[]; total: number; page: number; pageSize: number;
}> {
  const params = new URLSearchParams({ keyword, page: String(page), pageSize: '20' });
  return get(`/purchase-arrival/purchase-orders?${params}`, signal, '采购订单读取失败，请重试');
}

export function getPurchaseOrder(poId: number, signal: AbortSignal): Promise<{
  order: PurchaseOrder;
  details: PurchaseOrderDetail[];
}> {
  // 后端返回单条 PO header + details 数组；前端组合成 { order, details } 形态。
  return get(`/purchase-arrival/purchase-orders/${encodeURIComponent(poId)}`, signal, '订单明细读取失败，请重试')
    .then((row: PurchaseOrder & { details: PurchaseOrderDetail[] }) => ({
      order: row,
      details: row.details,
    }));
}

export function getSummary(signal: AbortSignal): Promise<{ reviewedCount: number; days: number; dateRange: { start: string; end: string } }> {
  return get('/purchase-arrival/summary', signal, '已审核订单数量读取失败，请重试');
}

// ----- 打印 -----

export type Allocation = {
  rowId: number;
  planNumber: string;
  quantity: number;
};

export function createPrintOperation(
  poId: number,
  items: { rowId: number; copies: number }[],
  allocations: Allocation[] = [],
): Promise<PrintOperation> {
  return write('/purchase-arrival/print-operations', 'POST', { poId, items, allocations });
}

export function savePrintResult(operationId: string, result: PrintResult): Promise<PrintOperation> {
  return write(`/purchase-arrival/print-operations/${encodeURIComponent(operationId)}/result`, 'PUT', result);
}

export function getPrintCounts(poId: number, signal: AbortSignal): Promise<{ counts: Record<number, number> }> {
  return get(`/purchase-arrival/purchase-orders/${encodeURIComponent(poId)}/print-counts`, signal, '打印次数读取失败，请重试');
}