import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  base: '/',
  build: {
    modulePreload: {
      resolveDependencies: (filename, deps) => deps.filter((dep) => !dep.includes('firebase')),
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',
    rollupOptions: {
      input: { main: './index.html' },
      output: {
        manualChunks(id) {
          if (id.includes('html2pdf') || id.includes('html2canvas') || id.includes('jspdf') || id.includes('print')) return 'printing';
          if (id.includes('chart')) return 'chart';
          if (id.includes('qrcode')) return 'qrcode';
        },
      },
    },
  },
  plugins: [
    legacy({
      targets: ['Chrome >= 49', 'Safari >= 10', 'iOS >= 10', 'Firefox >= 52', 'Edge >= 14', 'Android >= 6', 'Samsung >= 4'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderLegacyChunks: true,
      polyfills: true,
    }),
  ],
});
