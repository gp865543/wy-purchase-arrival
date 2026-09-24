<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import BluetoothIcon from 'tdesign-icons-vue-next/esm/components/bluetooth';
import CheckIcon from 'tdesign-icons-vue-next/esm/components/check';
import CloseIcon from 'tdesign-icons-vue-next/esm/components/close';
import LinkIcon from 'tdesign-icons-vue-next/esm/components/link';
import LinkUnlinkIcon from 'tdesign-icons-vue-next/esm/components/link-unlink';
import RefreshIcon from 'tdesign-icons-vue-next/esm/components/refresh';
import SearchIcon from 'tdesign-icons-vue-next/esm/components/search';
import SettingIcon from 'tdesign-icons-vue-next/esm/components/setting';
import StopCircleIcon from 'tdesign-icons-vue-next/esm/components/stop-circle';
import { Button, Dialog, NoticeBar, Tag } from 'tdesign-mobile-vue';
import { printer, requestPrinter, type Device } from '../printer';
import { usePageBack } from '../pageBack';
import PrinterSettings from './PrinterSettings.vue';
const emit = defineEmits<{ back: [] }>();
const busy = ref(false);
const discoveryBusy = ref(false);
const error = ref('');
const timedOut = ref(false);
let searchRequested = false;
const devices = computed(() => printer.value?.devices.filter(device => device.discovered) ?? []);
const exhausted = computed(() => printer.value?.reconnect?.status === 'exhausted');
const selected = ref<Device>();
const settingsDevice = ref<Device>();
const connected = computed(() => printer.value?.connection.code === 0);
const reconnecting = computed(() => printer.value?.reconnect?.status === 'retrying');
const locked = computed(() => busy.value || !printer.value || printer.value?.printing || (printer.value?.connection.code === 1 && !reconnecting.value));
const status = computed(() => connected.value ? '已连接' : reconnecting.value ? '重连中' : exhausted.value ? '连接已断开' : timedOut.value ? '连接超时' : printer.value?.connection.code === 1 ? '连接中' : '未连接');
const statusClass = computed(() => connected.value ? 'status-connected' : reconnecting.value || printer.value?.connection.code === 1 ? 'status-connecting' : exhausted.value || printer.value?.connection.code === 3 ? 'status-failed' : timedOut.value ? 'status-timeout' : 'status-idle');
const displayError = computed(() => { const message = error.value || printer.value?.lastError?.message; return message && !timedOut.value ? message : ''; });
watch(() => printer.value?.connection, () => { if (printer.value?.connection.code !== 1) { error.value = ''; timedOut.value = false; } });
const back = usePageBack('bluetooth', () => emit('back'), () => { if (selected.value) { selected.value = undefined; return false; } return !busy.value; });
async function run(action: string, payload = {}) {
  const discovery = action.endsWith('Discovery');
  if (discovery ? discoveryBusy.value : busy.value) return;
  if (discovery) discoveryBusy.value = true; else busy.value = true;
  error.value = '';
  if (action === 'printer.startDiscovery') searchRequested = true;
  if (action === 'printer.connect') timedOut.value = false;
  try { await requestPrinter(action, payload); }
  catch (cause) { const message = cause instanceof Error ? cause.message : '蓝牙操作失败'; if (action === 'printer.connect' && /超时|timeout/i.test(message)) timedOut.value = true; else error.value = action === 'getState' ? '设备状态读取失败，请重试' : message; }
  finally { if (discovery) discoveryBusy.value = false; else busy.value = false; }
}
function choose(device: Device) {
  if (connected.value || reconnecting.value) selected.value = device;
  else void run('printer.connect', { deviceId: device.deviceId });
}
function connect() { const device = selected.value; selected.value = undefined; if (device) void run('printer.connect', { deviceId: device.deviceId }); }
function refresh() { if (document.visibilityState === 'visible' && !busy.value && !discoveryBusy.value) void run('getState'); }
onMounted(() => { void run('getState'); document.addEventListener('visibilitychange', refresh); });
onUnmounted(() => { document.removeEventListener('visibilitychange', refresh); if (searchRequested || printer.value?.scanning) void requestPrinter('printer.stopDiscovery').catch(() => {}); });
</script>
<template>
  <Dialog class="bluetooth-dialog" visible title="蓝牙连接" width="calc(100vw - 24px)" :z-index="2000" :cancel-btn="{ content: '关闭', disabled: busy }" @close="back">
    <div class="bluetooth-content">
      <section aria-labelledby="current-title">
        <div class="section-header">
          <h2 id="current-title">当前连接</h2>
          <Tag role="status" :class="statusClass">{{ status }}</Tag>
        </div>
        <div class="current-device">
          <BluetoothIcon
            size="32px"
            :class="{ connected }"
            style="fill: none"
            aria-hidden="true"
          />
          <div class="device-info">
            <strong>
              {{ printer?.connection.device?.name || '暂无连接设备' }}
            </strong>
            <span>
              {{ printer?.connection.device?.deviceId }}
            </span>
            <span v-if="printer?.printing"> 打印中 </span>
          </div>
        </div>
        <div v-if="connected || reconnecting" class="connection-actions">
          <Button
            variant="outline"
            :disabled="locked"
            @click="run('printer.disconnect')"
          >
            <template #icon>
              <component
                :is="reconnecting ? StopCircleIcon : LinkUnlinkIcon"
                size="18px"
                aria-hidden="true"
              />
            </template>
            {{ reconnecting ? '停止重连' : '断开连接' }}
          </Button>
          <Button
            v-if="connected && printer?.connection.device"
            variant="outline"
            :disabled="locked"
            @click="settingsDevice = { ...printer.connection.device }"
          >
            <template #icon>
              <SettingIcon size="18px" aria-hidden="true" />
            </template>
            参数配置
          </Button>
        </div>
        <Button
          v-if="exhausted && printer?.connection.device"
          :disabled="locked"
          @click="
            run('printer.connect', {
              deviceId: printer.connection.device.deviceId,
            })
          "
        >
          <template #icon>
            <RefreshIcon size="18px" aria-hidden="true" />
          </template>
          重新连接
        </Button>
      </section>
      <NoticeBar
        v-if="displayError"
        visible
        role="alert"
        theme="error"
        :content="displayError"
        :marquee="false"
      />
      <Button v-if="displayError" variant="text" :disabled="busy" @click="refresh">重新读取状态</Button>
      <section aria-labelledby="devices-title">
        <div class="section-header">
          <h2 id="devices-title">设备列表</h2>
          <Button
            class="discovery-button"
            theme="primary"
            variant="base"
            size="small"
            :disabled="
              discoveryBusy || (!printer?.scanning && (locked || reconnecting))
            "
            @click="
              run(
                printer?.scanning
                  ? 'printer.stopDiscovery'
                  : 'printer.startDiscovery',
              )
            "
          >
            <template #icon>
              <component
                :is="printer?.scanning ? StopCircleIcon : SearchIcon"
                size="18px"
                aria-hidden="true"
              />
            </template>
            {{ printer?.scanning ? '停止搜寻' : '搜寻设备' }}
          </Button>
        </div>
        <p
          role="status"
          :style="{ visibility: printer?.scanning ? 'visible' : 'hidden' }"
        >
          正在搜寻附近设备…
        </p>
        <ul v-if="devices.length > 0" class="device-list">
          <li
            v-for="device in devices"
            :key="device.deviceId"
            class="device-row"
          >
            <div class="device-info">
              <strong>
                {{ device.name }}
              </strong>
              <span>
                {{ device.deviceId }}
              </span>
            </div>
            <span v-if="!device.bonded">未配对</span>
            <span
              v-else-if="
                connected &&
                printer?.connection.device?.deviceId === device.deviceId
              "
              class="connected"
            >
              已连接
            </span>
            <Button
              v-else
              theme="primary"
              size="small"
              :disabled="locked"
              @click="choose(device)"
            >
              <template #icon>
                <LinkIcon size="18px" aria-hidden="true" />
              </template>
              连接
            </Button>
          </li>
        </ul>
        <p v-else-if="!printer?.scanning">暂无设备，点击“搜寻设备”查找</p>
      </section>
    </div>
  </Dialog>
  <Dialog v-if="selected" visible title="切换设备" :content="`断开 ${printer?.connection.device?.name} 并连接 ${selected?.name}？`" :z-index="2100">
    <template #actions><div class="connection-actions">
      <Button variant="outline" @click="selected = undefined"><template #icon><CloseIcon /></template>取消</Button>
      <Button theme="primary" :disabled="locked" @click="connect"><template #icon><CheckIcon /></template>确认连接</Button>
    </div></template>
  </Dialog>
  <PrinterSettings v-if="settingsDevice" :device="settingsDevice" @close="settingsDevice = undefined" />
</template>

<style scoped>
h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 18px;
}

h2 {
  font-size: 16px;
}

.bluetooth-content {
  height: 60vh;
  overflow: auto;
  overscroll-behavior: contain;
  display: grid;
  align-content: start;
  gap: 16px;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-container);
}
:deep(.t-dialog__content) { padding: 16px 12px; }
.connection-actions > button { padding: 0 6px; }

section {
  min-width: 0;
  padding: 16px;
  background: var(--td-bg-color-container);
  border-radius: var(--td-radius-default);
}

.section-header {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.discovery-button {
  color: var(--td-font-white-1);
  background: var(--td-brand-color);
  border: 1px solid var(--td-brand-color);
}

.current-device {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-top: 16px;
}

.current-device > svg {
  flex: none;
  color: var(--td-text-color-disabled);
}

.device-info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.device-info strong {
  font-size: 16px;
  overflow-wrap: anywhere;
}

.device-info span,
p {
  font-size: 14px;
  color: var(--td-text-color-secondary);
  overflow-wrap: anywhere;
}

.connection-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.connection-actions > * {
  flex: 1;
}

.device-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.device-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--td-component-border);
}

.section-header > button,
.device-row > span,
.device-row > button {
  flex: none;
  margin: 0;
}

.connected,
.status-connected {
  color: var(--td-success-color);
}

.status-connecting {
  color: var(--td-brand-color);
}

.status-timeout {
  color: var(--td-warning-color);
}

.status-failed {
  color: var(--td-error-color);
}
</style>
