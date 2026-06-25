// Options page (POP-006): base URL / API key / model / trigger key / system prompt.
// Reads/writes chrome.storage.local via the config module (shared schema with the popup).
// Saves a partial patch so the popup-owned targetLang is left untouched.
import { DEFAULT_SYSTEM_PROMPT, loadSettings, saveSettings, type Settings } from '../config';

const form = document.getElementById('settings') as HTMLFormElement | null;
const status = document.getElementById('status');

function field(name: string): HTMLInputElement | HTMLTextAreaElement {
  return form!.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
}

async function populate(): Promise<void> {
  const s = await loadSettings();
  (field('baseUrl') as HTMLInputElement).value = s.baseUrl;
  (field('apiKey') as HTMLInputElement).value = s.apiKey;
  (field('model') as HTMLInputElement).value = s.model;
  // Trigger key is a single-select (Alt/Shift/Control); fall back to Alt if a legacy free-text
  // value is stored, so the content-script key matcher (e.key) always has a valid choice.
  const triggerRadios = form!.elements.namedItem('triggerKey') as RadioNodeList;
  triggerRadios.value = ['Alt', 'Shift', 'Control'].includes(s.triggerKey) ? s.triggerKey : 'Alt';
  (field('systemPrompt') as HTMLTextAreaElement).value = s.systemPrompt;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const patch: Pick<Settings, 'baseUrl' | 'apiKey' | 'model' | 'triggerKey' | 'systemPrompt'> = {
    baseUrl: String(fd.get('baseUrl') ?? '').trim(),
    apiKey: String(fd.get('apiKey') ?? ''),
    model: String(fd.get('model') ?? '').trim(),
    triggerKey: String(fd.get('triggerKey') ?? 'Alt') || 'Alt',
    systemPrompt: String(fd.get('systemPrompt') ?? '').trim() || DEFAULT_SYSTEM_PROMPT,
  };
  await saveSettings(patch);
  if (status) {
    status.textContent = '已保存';
    setTimeout(() => { if (status) status.textContent = ''; }, 1500);
  }
});

void populate();