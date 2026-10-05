import { createApp } from 'vue';
import App from './App.vue';
import 'tdesign-mobile-vue/es/style/index.css';
import './style.css';

// PDA H5 把当前 URL 路径（去掉 origin + query）传给 App，让它按 path 路由。
// 例：/apps/purchase-arrival/putaway 走入库扫码。
createApp(App, {
  pathname: window.location.pathname,
}).mount('#app');
