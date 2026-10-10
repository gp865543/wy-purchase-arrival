import assert from 'node:assert/strict';
globalThis.window = new EventTarget();
let failAt = -1;
let eventProgress = false;
const actions = [];
window.__WY_SHELL_TRANSPORT__ = { session: 'batch-check', send(request) {
  const { action, payload } = request;
  actions.push(action);
  let data = {};
  if (action === 'getState') data = { printer: { connection: { code: 0, device: { deviceId: 'AA:01' } }, devices: [], printing: false, scanning: false } };
  if (action === 'printer.printBatchStart') data = { jobId: 'job-1', deviceId: 'AA:01' };
  if (action === 'printer.printBatchAppend') {
    if (payload.index === failAt) return queueMicrotask(() => window.__WY_SHELL_RECEIVE__({ ...request, type: 'response', ok: false, error: { message: '发送失败' } }));
    data = { jobId: 'job-1', index: payload.index, completed: eventProgress ? 0 : payload.index + 1 };
  }
  if (action === 'printer.printBatchCommit') {
    data = { jobId: 'job-1', deviceId: 'AA:01', count: 3 };
    if (eventProgress) queueMicrotask(() => window.__WY_SHELL_RECEIVE__({ session: request.session, type: 'event', event: 'printer.batchProgress', data: { jobId: 'job-1', completed: 3 } }));
  }
  queueMicrotask(() => window.__WY_SHELL_RECEIVE__({ ...request, type: 'response', ok: true, data }));
} };
const { requestPrinter, sendLabels } = await import('../src/printer.ts');
const device = { deviceId: 'AA:01', settings: { printerType: 'K329' } };
const labels = Array.from({ length: 3 }, () => ({ dataBase64: btoa('PRINT 1,1\r\n') }));
const progress = [];
await sendLabels(device, labels, count => progress.push(count));
assert.deepEqual(progress, [1, 2, 3]);
assert.equal(actions.filter(action => action === 'printer.printBatchCommit').length, 1);
eventProgress = true;
progress.length = 0;
await sendLabels(device, labels, count => progress.push(count));
assert.deepEqual(progress, [3]);
eventProgress = false;
failAt = 1;
progress.length = 0;
await assert.rejects(sendLabels(device, labels, count => progress.push(count)), /发送失败/);
assert.deepEqual(progress, [1]);
assert.equal(actions.at(-1), 'printer.printBatchCancel');
let foreground = 0;
window.addEventListener('wy-shell-foreground', () => foreground++);
await requestPrinter('shell.openBluetoothPage');
window.__WY_SHELL_RECEIVE__({ session: 'batch-check', type: 'event', event: 'visibility', data: { foreground: true } });
assert.equal(foreground, 1);
assert.equal(actions.at(-1), 'shell.openBluetoothPage');
console.log('Batch order, progress, cancellation, and shell Bluetooth return passed.');
