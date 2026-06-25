import { defineManifest } from '@crxjs/vite-plugin';

export const manifest = defineManifest({
  manifest_version: 3,
  name: 'Chrome Translator',
  version: '0.1.0',
  description: 'AI-powered hover/selection translation with a per-page context session.',
  action: {
    default_popup: 'src/popup/index.html',
  },
  options_ui: {
    page: 'src/options/page.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/sw.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/inject.ts'],
    },
  ],
  permissions: ['contextMenus', 'storage'],
  host_permissions: ['<all_urls>'],
});