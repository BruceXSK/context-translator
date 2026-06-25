// Popup settings form (POP-001). Reads/writes settings via chrome.storage.local.
import { DEFAULT_SYSTEM_PROMPT, loadSettings, saveSettings, type Settings } from '../config';

const form = document.getElementById('settings') as HTMLFormElement | null;
const status = document.getElementById('status');

function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return form!.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

async function populate(): Promise<void> {
  const s = await loadSettings();
  (field('baseUrl') as HTMLInputElement).value = s.baseUrl;
  (field('apiKey') as HTMLInputElement).value = s.apiKey;
  (field('model') as HTMLInputElement).value = s.model;
  (field('targetLang') as HTMLSelectElement).value = s.targetLang;
  (field('triggerKey') as HTMLInputElement).value = s.triggerKey;
  (field('systemPrompt') as HTMLTextAreaElement).value = s.systemPrompt;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const next: Settings = {
    baseUrl: String(fd.get('baseUrl') ?? '').trim(),
    apiKey: String(fd.get('apiKey') ?? ''),
    model: String(fd.get('model') ?? '').trim(),
    targetLang: String(fd.get('targetLang') ?? 'zh-CN'),
    triggerKey: String(fd.get('triggerKey') ?? 'Alt').trim() || 'Alt',
    systemPrompt: String(fd.get('systemPrompt') ?? '').trim() || DEFAULT_SYSTEM_PROMPT,
  };
  await saveSettings(next);
  if (status) {
    status.textContent = '已保存';
    setTimeout(() => { if (status) status.textContent = ''; }, 1500);
  }
});

void populate();