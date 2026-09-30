import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const htmlEntries = {
  index: 'index.html',
  ward: 'ward.html',
  manager: 'manager.html',
  maintenance: 'maintenance.html',
  managerTemplate: 'manager-template.html',
};

const input = Object.fromEntries(
  Object.entries(htmlEntries)
    .filter(([, file]) => existsSync(resolve(root, file)))
    .map(([name, file]) => [name, resolve(root, file)]),
);

function bundleSupabaseInsteadOfRuntimeCdn() {
  const cdnIds = new Set([
    'https://esm.sh/@supabase/supabase-js@2',
    'https://esm.sh/@supabase/supabase-js@2.117.2',
  ]);

  return {
    name: 'night-memo-local-supabase',
    async resolveId(source, importer, options) {
      if (!cdnIds.has(source)) return null;
      const resolved = await this.resolve('@supabase/supabase-js', importer, {
        ...options,
        skipSelf: true,
      });
      return resolved?.id || null;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [bundleSupabaseInsteadOfRuntimeCdn()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input },
  },
});
