// Popup quick settings (POP-001): target language + open the settings page.
// Reads/writes chrome.storage.local via the config module; saves a partial patch so
// the options-page-owned fields (baseUrl/apiKey/model/triggerKey/customPrompt) stay intact.
import { loadSettings, saveSettings } from '../config';
import type { RuntimeResponse, Usage, UsageSnapshot } from '../shared/messages';

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

// Current-page token usage (POP-003): query the active tab's content for its session
// usage (cumulative + last translation) and render the context gauge + cache hit rates.
async function loadPageInfo(): Promise<void> {
  const s = await loadSettings();
  const maxContextK = s.maxContextK > 0 ? s.maxContextK : 1000;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let snap: UsageSnapshot | null = null;
  if (tab?.id != null) {
    snap = await new Promise<UsageSnapshot | null>((resolve) => {
      chrome.tabs.sendMessage(tab.id!, { kind: 'getUsage' }, (resp: unknown) => {
        const r = resp as RuntimeResponse | undefined;
        if (chrome.runtime.lastError || !r || r.kind !== 'usage') {
          resolve(null);
          return;
        }
        resolve(r.usage);
      });
    });
  }
  renderPageInfo(snap, maxContextK);
}

function renderPageInfo(snap: UsageSnapshot | null, maxContextK: number): void {
  const ctxText = document.getElementById('ctxText');
  const ctxFill = document.getElementById('ctxFill');
  const lastRate = document.getElementById('lastRate');
  const totalRate = document.getElementById('totalRate');
  if (!ctxText || !ctxFill || !lastRate || !totalRate) return;

  const maxLabel = formatMaxLabel(maxContextK);
  const maxContext = maxContextK * 1000;
  const last = snap?.last ?? null;

  // Context usage = latest translation response's prompt_tokens vs maxContext (POP-003/CFG-006).
  if (snap && last) {
    const used = last.promptTokens;
    const usedK = formatK(used);
    const pct = maxContext > 0 ? Math.round((used / maxContext) * 100) : 0;
    ctxText.textContent = `${usedK}/${maxLabel} (${pct}%)`;
    const fillPct = used > 0 ? Math.max(pct, 3) : 0; // min sliver when >0 but pct rounds to 0
    ctxFill.style.width = `${Math.min(fillPct, 100)}%`;
  } else if (snap) {
    // content present but no translations yet on this page
    ctxText.textContent = `0K/${maxLabel} (0%)`;
    ctxFill.style.width = '0%';
  } else {
    // no content script (restricted page) or query failed
    ctxText.textContent = '—';
    ctxFill.style.width = '0%';
  }

  lastRate.textContent = formatCacheRate(last);
  totalRate.textContent = formatCacheRate(snap?.cumulative ?? null);
}

/** Integer K, rounded; `<1K` when nonzero but under 0.5K; `0K` when zero. */
function formatK(tokens: number): string {
  if (tokens <= 0) return '0K';
  const k = Math.round(tokens / 1000);
  return k === 0 ? '<1K' : `${k}K`;
}

/** `M` when maxContextK≥1000 (1000→1M, 1500→1.5M), else `K`. */
function formatMaxLabel(maxContextK: number): string {
  if (maxContextK >= 1000) {
    const m = maxContextK / 1000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  return `${maxContextK}K`;
}

/** `hit/(hit+miss)` as a one-decimal percent; `—` when cache fields absent or zero denominator. */
function formatCacheRate(u: Usage | null): string {
  if (!u) return '—';
  const hit = u.promptCacheHitTokens;
  const miss = u.promptCacheMissTokens;
  if (hit == null || miss == null) return '—';
  const sum = hit + miss;
  if (sum <= 0) return '—';
  return `${((hit / sum) * 100).toFixed(1)}%`;
}

void populate();
void loadPageInfo();