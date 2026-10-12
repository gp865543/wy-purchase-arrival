import { createApp } from 'vue';
import TDesign from 'tdesign-mobile-vue';

import App from './App.vue';
import router from './router';

import 'tdesign-mobile-vue/es/style/index.css';
import './style.css';

createApp(App).use(TDesign).use(router).mount('#app');
