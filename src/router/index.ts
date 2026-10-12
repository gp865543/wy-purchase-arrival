import { createRouter, createWebHashHistory } from 'vue-router';

// 与 wy-customer-material-receipt 同样的 hash router，避免 PDA WebView 上
// 路径上的 import.meta.env.BASE_URL 变化（/apps/purchase-arrival/ vs /）造成 reload。
const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/orders',
      name: 'orders',
      component: () => import('../views/receipt-arrival/List.vue'),
    },
    {
      path: '/orders/:order',
      name: 'order',
      component: () => import('../views/receipt-arrival/Order.vue'),
    },
    {
      path: '/orders/:order/materials/:material/receipt',
      name: 'receipt',
      component: () => import('../views/receipt-arrival/Receipt.vue'),
    },
    { path: '/', redirect: '/orders' },
  ],
});

export default router;
