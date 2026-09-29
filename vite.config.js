import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // This app uses the custom domain night-memo.eu.cc.
  base: '/',

  build: {
    rollupOptions: {
      input: {
        index: resolve(process.cwd(), 'index.html'),
        login: resolve(process.cwd(), 'login.html'),
        ward: resolve(process.cwd(), 'ward.html'),
        manager: resolve(process.cwd(), 'manager.html'),
        maintenance: resolve(process.cwd(), 'maintenance.html'),
        managerTemplate: resolve(process.cwd(), 'manager-template.html'),
      },
    },
  },
});
