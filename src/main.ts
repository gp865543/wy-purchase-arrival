import { createApp } from 'vue';
import App from './App.vue';
import 'tdesign-mobile-vue/es/style/index.css';
import './style.css';

// === DEBUG LOG (在浏览器 Console 看到这里确认状态) ===
console.log('[DIAG:wy-purchase-arrival main.ts] booting');
console.log('[DIAG] location.href:', window.location.href);
console.log('[DIAG] location.pathname:', window.location.pathname);
console.log('[DIAG] location.search:', window.location.search);
console.log('[DIAG] location.hash:', window.location.hash);
console.log('[DIAG] __WY_SHELL_TRANSPORT__ present?:', !!window.__WY_SHELL_TRANSPORT__);

// PDA H5 把当前 URL 路径（去掉 origin + query）传给 App，让它按 path 路由。
// 例：/apps/purchase-arrival/putaway 走入库扫码。
const pathname = window.location.pathname;
console.log('[DIAG:wy-purchase-arrival main.ts] pathname to pass:', pathname);

createApp(App, { pathname }).mount('#app');
console.log('[DIAG:wy-purchase-arrival main.ts] createApp done');