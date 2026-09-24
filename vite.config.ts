import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: env.VITE_BASE || '/apps/purchase-arrival/',
    plugins: [vue(), {
      name: 'omit-dependency-sourcemaps',
      apply: 'serve',
      enforce: 'post',
      // ponytail: omit dependency maps on PDA; remove this transform for dependency debugging.
      transform(code, id) {
        if (id.includes('/node_modules/.vite/')) return { code, map: { mappings: '' } };
      },
    }],
    build: { target: 'es2020' },
    server: {
      proxy: {
        '/api/v1/purchase-arrival': {
          target: env.PURCHASE_ARRIVAL_API_PROXY || 'http://127.0.0.1:16101',
        },
        '/api': { target: env.IDENTITY_API_PROXY || 'http://127.0.0.1:16101' },
      },
    },
  };
});