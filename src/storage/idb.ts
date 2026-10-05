// 浏览器端 IndexedDB 缓存层。PDA 现场弱网/断网时仍能加载最近看过的采购订单与 receipts。
//
// 设计目标：
// - 列表 (purchase_orders) + 明细 (po_detail, 含 receipts) 都缓存
// - 不设 TTL：与后端数据走"最近同步时间戳 + 后台拉取"对齐，receipts 持久化
//   由后端管，前端缓存只是"加快冷启动"。
// - 优先本地 → 后台异步拉远端 → 合并（stale-while-revalidate）

interface PoSummary {
  poId: number;
  orderNo: string;
  vendorCode: string;
  vendorName: string;
  departmentCode: string;
  departmentName: string;
  orderDate: string | null;
  fetchedAt: number;
}

interface PoDetail {
  poId: number;
  detail: unknown;
  receipts: unknown[];
  fetchedAt: number;
}

const DB_NAME = 'wy-purchase-arrival';
const DB_VERSION = 1;
const STORE_LIST = 'po_summary';
const STORE_DETAIL = 'po_detail';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LIST)) {
        db.createObjectStore(STORE_LIST, { keyPath: 'poId' });
      }
      if (!db.objectStoreNames.contains(STORE_DETAIL)) {
        db.createObjectStore(STORE_DETAIL, { keyPath: 'poId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
}

// 单事务内做若干 IDB 操作，事务 commit 后 resolve。错误路径通过 reject / catch 吞掉，
// 调用方不会因为 IDB 失败阻塞业务逻辑（缓存只是性能优化）。
function runTransaction(
  store: string,
  mode: IDBTransactionMode,
  body: (s: IDBObjectStore) => void,
): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    try { body(transaction.objectStore(store)); }
    catch (cause) { reject(cause); }
  })).catch(() => { /* IDB 不可用（私模 / Safari ITP / 配额满）静默降级 */ });
}

// 单只 get 取一个值（idb key = poId）。
function getOne<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(db => new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const req = transaction.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    transaction.onerror = () => reject(transaction.error);
  })).catch(() => undefined);
}

function getAll<T>(store: string): Promise<T[]> {
  return openDb().then(db => new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const req = transaction.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
    transaction.onerror = () => reject(transaction.error);
  })).catch(() => []);
}

// ---- PO summary list ----

export async function cachePoSummaries(items: Omit<PoSummary, 'fetchedAt'>[]): Promise<void> {
  if (!items.length) return;
  const now = Date.now();
  try {
    await openDb().then(db => new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_LIST, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      const store = transaction.objectStore(STORE_LIST);
      for (const item of items) {
        store.put({ ...item, fetchedAt: now });
      }
      transaction.commit();
    }));
  } catch { /* ignore quota / private mode failures */ }
}

export async function loadPoSummaries(): Promise<PoSummary[]> {
  try {
    const all = getAll<PoSummary>(STORE_LIST);
    return all ?? [];
  } catch {
    return [];
  }
}

export async function clearPoSummaries(): Promise<void> {
  try {
    await runTransaction(STORE_LIST, 'readwrite', s => s.clear());
  } catch { /* ignore */ }
}

// ---- PO detail (with receipts) ----

export async function cachePoDetail(poId: number, detail: unknown, receipts: unknown[]): Promise<void> {
  try {
    await runTransaction(STORE_DETAIL, 'readwrite', s => s.put({ poId, detail, receipts, fetchedAt: Date.now() } as PoDetail));
  } catch { /* ignore */ }
}

export async function loadPoDetail(poId: number): Promise<PoDetail | undefined> {
  try {
    return getOne<PoDetail>(STORE_DETAIL, poId);
  } catch {
    return undefined;
  }
}

export async function clearAll(): Promise<void> {
  try {
    await Promise.all([clearPoSummaries(), runTransaction(STORE_DETAIL, 'readwrite', s => s.clear())]);
  } catch { /* ignore */ }
}

export type { PoSummary, PoDetail };