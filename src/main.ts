import { createApp } from 'vue';
import App from './App.vue';
import 'tdesign-mobile-vue/es/style/index.css';
import './style.css';

// PDA H5 解析 URL 中的 page 参数（portal/desktop 通过 ?page=putaway 跳转到 PDA 入库扫码）
function getQueryParam(name: string): string | undefined {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) ?? undefined;
}

createApp(App, {
  page: getQueryParam('page'),
}).mount('#app');