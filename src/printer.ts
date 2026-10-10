import { shallowRef } from 'vue';

export type PrinterSettings = {
  language: string; paperWidth: number; paperHeight: number; mediaType: string;
  gap: number; blackMarkHeight: number; blackMarkOffset: number;
  x: number; y: number; direction: number; dpi: string | number;
};
export type DeviceSnapshot = { deviceId: string; settings: PrinterSettings };
export type Device = { deviceId: string; name: string; bonded?: boolean; discovered?: boolean };
type State = { connection: { code: number; device: Device | null }; devices: Device[]; printing: boolean; scanning: boolean; reconnect?: { status: string; attempt: number }; lastError?: { message: string } | null };
type Message = { session: string; type: string; id?: string; event?: string; ok?: boolean; data?: unknown; error?: { message: string } };
declare global {
  interface Window {
    __WY_SHELL_TRANSPORT__?: { session: string; send(request: object): void };
    __WY_SHELL_RECEIVE__?: (message: Message) => void;
  }
}
export const printer = shallowRef<State>();
// The Android transport navigates to wyshell:// synchronously.
export let sendingBridgeRequest = false;
let session = '', sequence = 0;
let handshake: Promise<void> | undefined;
const pending = new Map<string, { resolve(data: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
function apply(data: unknown) {
  if (!data || typeof data !== 'object') return;
  const value = 'printer' in data ? data.printer : data;
  if (value && typeof value === 'object' && 'connection' in value && 'devices' in value) printer.value = value as State;
}
function receive(message: Message) {
  if (message.session !== session) return;
  if (message.type === 'event') { if (message.event === 'printer.batchProgress') window.dispatchEvent(new CustomEvent('wy-print-progress', { detail: message.data })); if (message.event === 'visibility' && (message.data as { foreground?: boolean })?.foreground) window.dispatchEvent(new Event('wy-shell-foreground')); if (message.event?.startsWith('printer.')) apply(message.data); return; }
  if (message.type !== 'response') return;
  const task = message.id && pending.get(message.id);
  if (!task || !message.id) return;
  clearTimeout(task.timer); pending.delete(message.id);
  if (message.ok) { apply(message.data); task.resolve(message.data); }
  else task.reject(new Error(message.error?.message || '设备操作失败'));
}
function envelope(action: string, payload: object, id = `${session}-${sequence + 1}`) { return { action, id, payload, session }; }
export function checkCapacity(payload: { dataBase64: string } & DeviceSnapshot) {
  if (payload.dataBase64.length > 196608 || ('wyshell://request?data=' + encodeURIComponent(JSON.stringify(envelope('printer.printTspl', payload, '9'.repeat(128))))).length > 262144) throw new Error('标签位图超过壳请求容量');
}

function send(action: string, payload: object = {}) {
  const transport = window.__WY_SHELL_TRANSPORT__;
  if (!transport || transport.session !== session) return Promise.reject(new Error('请在 PDA 应用内连接打印机'));
  const id = `${session}-${++sequence}`;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error((action === 'printer.printTspl' || action.startsWith('printer.printBatch')) ? '发送结果未确认；Web 超时不会取消壳内操作，请核对出纸后再次打印' : '设备请求超时，请重试'));
    }, action.startsWith('printer.printBatch') && action !== 'printer.printBatchCancel' ? 300_000 : action === 'printer.getStorage' ? 125_000 : action === 'printer.printTspl' || action === 'printer.listPaired' ? 60_000 : 15_000);
    pending.set(id, { resolve, reject, timer });
    try { sendingBridgeRequest = true; transport.send(envelope(action, payload, id)); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    finally { sendingBridgeRequest = false; }
  });
}
window.addEventListener('wy-shell-ready', () => {
  if (!session || window.__WY_SHELL_TRANSPORT__?.session === session) return;
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('设备通信会话已更新')); }
  pending.clear(); handshake = undefined;
});
export async function requestPrinter(action: string, payload: object = {}, retryRead = true): Promise<unknown> {
  const next = window.__WY_SHELL_TRANSPORT__?.session;
  if (!next) throw new Error('请在 PDA 应用内连接打印机');
  window.__WY_SHELL_RECEIVE__ = receive;
  if (session !== next || !handshake) {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('壳会话已更新，请核对出纸')); }
    pending.clear(); session = next; sequence = 0; printer.value = undefined;
    const current = (async () => { await send('ready'); await send('getState'); })();
    handshake = current;
    current.catch(() => { if (handshake === current) handshake = undefined; });
  }
  try {
    await handshake;
    return await send(action, payload);
  } catch (cause) {
    if (retryRead && ['getState', 'printer.getSettings', 'printer.listPaired'].includes(action) && window.__WY_SHELL_TRANSPORT__?.session !== next) return requestPrinter(action, payload, false);
    throw cause;
  }
}
export async function deviceSnapshot(): Promise<DeviceSnapshot> {
  await requestPrinter('getState');
  const state = printer.value;
  if (state?.connection.code !== 0 || !state.connection.device?.deviceId) throw new Error('请先连接打印机');
  if (state.printing || state.scanning) throw new Error('设备忙碌，请稍后重试');
  const deviceId = state.connection.device.deviceId;
  const data = await requestPrinter('printer.getSettings', { deviceId }) as DeviceSnapshot;
  if (!data?.settings || data.deviceId.toUpperCase() !== deviceId.toUpperCase()) throw new Error('请在门户保存该打印机的参数后重试');
  return data;
}
export async function sendLabel(device: DeviceSnapshot, command: { dataBase64: string }) {
  checkCapacity({ ...device, ...command });
  const response = await requestPrinter('printer.printTspl', { ...device, dataBase64: command.dataBase64 }) as { deviceId?: string; result?: unknown };
  if (!response || !('result' in response) || response.deviceId?.toUpperCase() !== device.deviceId.toUpperCase()) throw new Error('打印响应无效，请核对出纸');
}

export async function sendLabels(device: DeviceSnapshot, commands: { dataBase64: string }[], onProgress: (completed: number) => void) {
  const started = await requestPrinter('printer.printBatchStart', device) as { jobId?: string; deviceId?: string };
  if (!started?.jobId || started.deviceId?.toUpperCase() !== device.deviceId.toUpperCase()) throw new Error('打印批次响应无效，请核对出纸');
  const jobId = started.jobId;
  let completed = 0;
  const progress = (event: Event) => {
    const data = (event as CustomEvent<{ jobId?: string; completed?: number }>).detail;
    if (data?.jobId === jobId && Number.isSafeInteger(data.completed) && data.completed! > completed && data.completed! <= commands.length) {
      completed = data.completed!;
      onProgress(completed);
    }
  };
  window.addEventListener('wy-print-progress', progress);
  try {
    for (const [index, command] of commands.entries()) {
      checkCapacity({ ...device, ...command });
      const appended = await requestPrinter('printer.printBatchAppend', { jobId, index, dataBase64: command.dataBase64 }) as { jobId?: string; index?: number; completed?: number };
      if (appended?.jobId !== jobId || appended.index !== index) throw new Error('打印标签接收结果不一致，请核对出纸');
      if (Number.isSafeInteger(appended.completed) && appended.completed! > completed && appended.completed! <= commands.length) {
        completed = appended.completed!;
        onProgress(completed);
      }
    }
    const committed = await requestPrinter('printer.printBatchCommit', { jobId }) as { jobId?: string; deviceId?: string; count?: number };
    if (committed?.jobId !== jobId || committed.deviceId?.toUpperCase() !== device.deviceId.toUpperCase() || committed.count !== commands.length) throw new Error('打印批次结果未确认，请核对出纸');
    if (completed < commands.length) onProgress(commands.length);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes('Web 超时'))) await requestPrinter('printer.printBatchCancel', { jobId }, false).catch(() => {});
    throw error;
  } finally {
    window.removeEventListener('wy-print-progress', progress);
  }
}

// Files remain in DRAM only. The printer processes the cleanup after the print commands.
export async function sendStoredLabels(device: DeviceSnapshot, labels: import('./pcx').StoredLabel[],
  onBatch: (start: number, count: number, error?: Error) => void, progress: (message: string) => void = () => {}, nextBatch: () => void = () => {}) {
  const names = Array.from({ length: 50 }, (_, i) => `WM${String(i).padStart(2, '0')}.PCX`);
  const bytesCommand = (parts: (string | Uint8Array)[]) => {
    let binary = '';
    for (const part of parts) {
      if (typeof part === 'string') binary += part;
      else for (let i = 0; i < part.length; i += 8192) binary += String.fromCharCode(...part.subarray(i, i + 8192));
    }
    return { dataBase64: btoa(binary) };
  };
  const readStorage = async () => {
    const state = await requestPrinter('printer.getStorage', { deviceId: device.deviceId }) as { freeBytes: number; files: string[] };
    if (!Number.isSafeInteger(state?.freeBytes) || state.freeBytes < 0 || !Array.isArray(state.files) || state.files.some(f => typeof f !== 'string')) throw new Error('打印机存储状态无效');
    return state;
  };
  let storage = await readStorage();
  const stale = storage.files.filter(name => names.includes(name));
  if (stale.length) {
    await sendLabel(device, bytesCommand(stale.map(name => `KILL "${name}"\r\n`)));
    storage = await readStorage();
    if (storage.files.some(name => names.includes(name))) throw new Error('打印机临时图片未清理，请重启打印机');
  }
  for (let start = 0; start < labels.length;) {
    // Reserve workspace and per-file allocation overhead; capacity is rechecked on every batch.
    let budget = storage.freeBytes - 64 * 1024, end = start;
    while (end < labels.length && end - start < 50) {
      const size = labels[end]!.image.length + 4096;
      if (size > budget) break;
      budget -= size; end++;
    }
    if (end === start) throw new Error('打印机可用内存不足以存入一张标签');
    const batch = labels.slice(start, end), used = names.slice(0, batch.length);
    let triggered = false;
    try {
      progress(`传输中 ${start}/${labels.length}`);
      const downloads = batch.map((label, i) => bytesCommand([`DOWNLOAD "${used[i]}",${label.image.length},`, label.image, '\r\n']));
      await sendLabels(device, downloads, () => {}, completed => progress(`传输中 ${start + completed}/${labels.length}`));
      progress('核对打印数据...');
      storage = await readStorage();
      if (used.some(name => !storage.files.includes(name))) throw new Error('标签图片未完整存入打印机，本批未打印');
      const parts: string[] = [];
      let initialization = '';
      for (const [i, label] of batch.entries()) {
        if (initialization !== label.initialization) { parts.push(label.initialization); initialization = label.initialization; }
        parts.push(`CLS\r\n${label.border}PUTPCX ${label.left},${label.top},"${used[i]}"\r\nPRINT 1,1\r\n`);
      }
      parts.push(...used.map(name => `KILL "${name}"\r\n`));
      progress('正在打印...');
      triggered = true;
      await sendLabel(device, bytesCommand(parts));
      storage = await readStorage();
      if (used.some(name => storage.files.includes(name))) throw new Error('本批打印结束状态未确认，请核对出纸');
      onBatch(start, batch.length);
      progress(`已打印 ${start + 1}-${end}`);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('打印失败');
      onBatch(start, batch.length, error);
      if (!triggered) await sendLabel(device, bytesCommand(used.map(name => `KILL "${name}"\r\n`))).catch(() => {});
      throw error;
    }
    start = end;
    if (start < labels.length) nextBatch();
  }
}
