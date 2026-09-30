// 移动壳扫码桥接（参考 wy-material-requisition/src/shell.ts）
//
// 壳单向推 `pda.scan` 事件，data 是解码后的纯字符串。
// 壳只在 session 与 ready 都成立时才 emit；未握手期间扫到的直接丢。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShellMessage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShellTransport = any;

const listeners = new Set<(code: string) => void>();
const pending = new Map<
  string,
  { resolve(data: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
>();
let session = '';
let sequence = 0;
let initialized = false;

function receive(message: ShellMessage) {
  if (message.session !== session) return;
  if (message.type === 'event') {
    if (message.event === 'pda.scan' && typeof message.data === 'string' && message.data) {
      for (const listener of listeners) listener(message.data);
    }
    return;
  }
  if (message.type !== 'response' || !message.id) return;
  const task = pending.get(message.id);
  if (!task) return;
  clearTimeout(task.timer);
  pending.delete(message.id);
  if (message.ok) task.resolve(message.data);
  else task.reject(new Error(message.error?.message || '壳操作失败'));
}

function send(action: string, payload: object = {}) {
  const transport = window.__WY_SHELL_TRANSPORT__ as ShellTransport | undefined;
  if (!transport || transport.session !== session)
    return Promise.reject(new Error('请在 PDA 应用内扫码'));
  const id = `${session}-${++sequence}`;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('壳请求超时'));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    try {
      transport.send({ action, id, payload, session });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

async function attach() {
  const transport = window.__WY_SHELL_TRANSPORT__ as ShellTransport | undefined;
  if (!transport) return;
  if (transport.session === session) return;
  const current = transport.session;
  session = current;
  sequence = 0;
  window.__WY_SHELL_RECEIVE__ = receive;
  try {
    await send('ready');
    if (session !== current) return;
  } catch {
    if (session !== current) return;
    session = '';
  }
}

export function initShell() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('wy-shell-ready', () => void attach());
  window.addEventListener('pageshow', () => void attach());
  window.addEventListener('pagehide', () => {
    session = '';
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error('页面已离开'));
    }
    pending.clear();
  });
  void attach();
}

/** 订阅扫码。同一个页面只留最近一次结果。 */
export function onScan(listener: (code: string) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}