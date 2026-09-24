<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CloseIcon from 'tdesign-icons-vue-next/esm/components/close';
import PrintIcon from 'tdesign-icons-vue-next/esm/components/print';
import RefreshIcon from 'tdesign-icons-vue-next/esm/components/refresh';
import SaveIcon from 'tdesign-icons-vue-next/esm/components/save';
import { Button, Dialog, Input, NoticeBar, Radio, RadioGroup, Toast } from 'tdesign-mobile-vue';
import { printer, requestPrinter, sendLabel, type Device, type DeviceSnapshot, type PrinterSettings } from '../printer';
import { compileCalibration } from '../calibration';
import { usePageBack } from '../pageBack';
const props = defineProps<{ device: Device }>();
const emit = defineEmits<{ close: [] }>();
const busy = ref(false), loaded = ref(false), error = ref('');
const draft = ref<PrinterSettings>({ language: 'TSPL', paperWidth: 80, paperHeight: 60, mediaType: 'gap', gap: 2, blackMarkHeight: 0, blackMarkOffset: 0, x: 0, y: 0, direction: 0, dpi: '' });
const fields = computed(() => [
  { key: 'paperWidth', label: '标签宽度（mm）' }, { key: 'paperHeight', label: '标签高度（mm）' },
  ...(draft.value.mediaType === 'gap' ? [{ key: 'gap', label: '标签间隙（mm）' }] : []),
  ...(draft.value.mediaType === 'blackMark' ? [{ key: 'blackMarkHeight', label: '黑标高度（mm）' }, { key: 'blackMarkOffset', label: '黑标偏移（mm）' }] : []),
  { key: 'x', label: '水平偏移 X（mm）' }, { key: 'y', label: '垂直偏移 Y（mm）' },
] as { key: 'paperWidth' | 'paperHeight' | 'gap' | 'blackMarkHeight' | 'blackMarkOffset' | 'x' | 'y'; label: string }[]);
const sameDevice = computed(() => printer.value?.connection.code === 0 && printer.value.connection.device?.deviceId.toUpperCase() === props.device.deviceId.toUpperCase());
const canSave = computed(() => loaded.value && !busy.value && sameDevice.value && !printer.value?.printing);
const close = usePageBack('printer-settings', () => emit('close'), () => !busy.value);
async function load() {
  busy.value = true; error.value = ''; loaded.value = false;
  try { const result = await requestPrinter('printer.getSettings', { deviceId: props.device.deviceId }) as DeviceSnapshot; if (result.settings) draft.value = { ...result.settings, ...(result.settings.mediaType === 'continuous' ? { mediaType: 'gap', gap: 2 } : {}) }; loaded.value = true; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '参数读取失败'; }
  finally { busy.value = false; }
}
async function save(test = false) {
  if (!canSave.value) return;
  busy.value = true; error.value = '';
  try {
    for (const field of fields.value) {
      const raw = draft.value[field.key];
      if (String(raw).trim() === '' || !Number.isFinite(Number(raw)) || (!['x', 'y'].includes(field.key) && Number(raw) < 0)) throw new Error(`请填写有效的${field.label}`);
    }
    const value = { ...draft.value, ...Object.fromEntries(fields.value.map(field => [field.key, Number(draft.value[field.key])])) };
    const saved = await requestPrinter('printer.saveSettings', { deviceId: props.device.deviceId, settings: { ...value, direction: Number(value.direction), gap: value.mediaType === 'gap' ? value.gap : 0, blackMarkHeight: value.mediaType === 'blackMark' ? value.blackMarkHeight : 0, blackMarkOffset: value.mediaType === 'blackMark' ? value.blackMarkOffset : 0 } }) as DeviceSnapshot;
    Toast({ message: '参数已保存', preventScrollThrough: false });
    if (test) {
      await sendLabel(saved, compileCalibration(saved.settings));
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '参数保存失败'; }
  finally { busy.value = false; }
}
onMounted(load);
</script>
<template>
  <Dialog visible title="打印设备参数" width="calc(100vw - 24px)" :z-index="2200" :cancel-btn="null" @close="close">
    <form class="settings-body" @submit.prevent="save()">
      <NoticeBar v-if="!sameDevice" visible role="status" content="请重连此设备后保存，填写内容已保留。" :marquee="false" />
      <NoticeBar v-else-if="printer?.printing" visible role="status" content="打印中，暂时无法保存参数。" :marquee="false" />
      <fieldset :disabled="!loaded || busy">
        <label v-for="field in fields.slice(0, 2)" :key="field.key"><span>{{ field.label }}</span><Input v-model="draft[field.key]" :name="field.key" :disabled="!loaded || busy" type="number" /></label>
        <div class="wide"><span id="paper-type">纸张类型</span><RadioGroup v-model="draft.mediaType" aria-labelledby="paper-type" :disabled="!loaded || busy"><label><Radio value="gap" label="间隙纸" /></label><label><Radio value="blackMark" label="黑标纸" /></label></RadioGroup></div>
        <label v-for="field in fields.slice(2)" :key="field.key"><span>{{ field.label }}</span><Input v-model="draft[field.key]" :name="field.key" :disabled="!loaded || busy" type="number" /></label>
        <p class="wide">X 正值向右，Y 正值向下；负值方向相反。</p>
        <label><span>分辨率（DPI）</span><Input v-model="draft.dpi" :disabled="!loaded || busy" placeholder="请填写实际规格" /></label>
      </fieldset>
      <NoticeBar v-if="error" visible role="alert" theme="error" :content="error" :marquee="false" />
      <footer>
        <Button v-if="error" class="retry-button" variant="outline" :disabled="busy || !sameDevice" @click="load"><template #icon><RefreshIcon size="18px" /></template>重新读取</Button>
        <Button variant="outline" :disabled="busy" @click="close"><template #icon><CloseIcon size="18px" /></template>关闭</Button>
        <Button theme="primary" type="submit" :disabled="!canSave"><template #icon><SaveIcon size="18px" /></template>{{ busy ? '处理中…' : '保存' }}</Button>
        <Button theme="primary" :disabled="!canSave" @click="save(true)"><template #icon><PrintIcon size="18px" /></template>打印测试</Button>
      </footer>
    </form>
  </Dialog>
</template>

<style scoped>
.settings-body { height: 60vh; overflow-y: auto; overflow-x: hidden; text-align: left; font: var(--td-font-body-medium); color: var(--td-text-color-primary); font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
p {
  margin: 8px 0;
  font-size: 14px;
  color: var(--td-text-color-secondary);
  overflow-wrap: anywhere;
}

fieldset {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-width: 0;
  padding: 0;
  margin: 16px 0;
  border: 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
  text-align: left;
}

.wide {
  grid-column: 1 / -1;
}

:deep(.t-input) {
  --td-input-vertical-padding: 8px;
  --td-input-horizontal-padding: 8px;
  --td-input-font-size: 14px;

  flex: none;
  margin-top: auto;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
}

:deep(.t-radio) {
  --td-radio-vertical-padding: 8px;
  --td-radio-horizontal-padding: 0px;
  --td-radio-label-font-size: 14px;
}

.wide :deep(.t-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}

footer :deep(.t-button) {
  min-width: 0;
  width: 100%;
  padding-right: 6px;
  padding-left: 6px;
}

footer .retry-button {
  grid-column: 1 / -1;
}

footer {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 0;
  background: var(--td-bg-color-container);
}
</style>
