// Popup quick settings (POP-001): target language + open the settings page.
// Reads/writes chrome.storage.local via the config module; saves a partial patch so
// the options-page-owned fields (baseUrl/apiKey/model/triggerKey/systemPrompt) stay intact.
import { loadSettings, saveSettings } from '../config';

const form = document.getElementById('settings') as HTMLFormElement | null;
const status = document.getElementById('status');
const openBtn = document.getElementById('openOptions');

function targetLangField(): HTMLSelectElement {
  return form!.elements.namedItem('targetLang') as HTMLSelectElement;
}

async function populate(): Promise<void> {
  const s = await loadSettings();
  targetLangField().value = s.targetLang;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({ targetLang: String(new FormData(form).get('targetLang') ?? 'zh-CN') });
  if (status) {
    status.textContent = '已保存';
    setTimeout(() => { if (status) status.textContent = ''; }, 1500);
  }
});

openBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

void populate();