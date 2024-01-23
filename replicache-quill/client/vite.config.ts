import {defineConfig} from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [],
  build: {
    target: 'esnext',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
      },
    },
  },
});
