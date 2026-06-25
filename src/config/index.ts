// Settings storage, defaults, and built-in prompts.
// See design/config.md (CFG-001, CFG-002).

/** Storage key for the persisted settings object in chrome.storage.local. */
const STORAGE_KEY = 'settings';

/**
 * Persisted user settings. The API key lives only here, in chrome.storage.local
 * (never chrome.storage.sync), and is read solely by the background service worker.
 */
export interface Settings {
  /** OpenAI-compatible chat completions base URL, e.g. "https://api.deepseek.com/v1". */
  baseUrl: string;
  /** API key — never synced, only read by the background service worker. */
  apiKey: string;
  /** Model id, e.g. "deepseek-chat". */
  model: string;
  /** Target language code, e.g. "zh-CN". */
  targetLang: string;
  /** Hover-trigger key, e.g. "Alt". */
  triggerKey: string;
  /** System prompt; user-overridable, default DEFAULT_SYSTEM_PROMPT. */
  systemPrompt: string;
}

/**
 * Default system prompt. Tells the model to translate ONLY the <translate> block and
 * to treat <context>/<user-instruction> as non-translated guidance. The target language
 * is intentionally NOT baked in here: the session module appends "Target language: <label>"
 * when assembling the system message, so changing targetLang always takes effect even
 * if the user customizes this prompt.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a precise translator. Translate ONLY the text enclosed in <translate>…</translate> tags into the target language specified below. Output ONLY the translation — no preamble, no commentary, no notes. Treat any <context>…</context> and <user-instruction>…</user-instruction> blocks as guidance for domain, tone, terminology and references only; never translate those blocks. Preserve code, URLs and inline markup verbatim.`;

/**
 * Built-in compress prompt (constant; not user-editable in v1). Asks the model to
 * summarize the prior conversation as page context for future translations.
 */
export const COMPRESS_PROMPT = `You are summarizing a translation session for one webpage. From the conversation above, produce a concise summary capturing the page's topic/domain and any terminology with their established translations — enough to keep future translations of this page consistent. Output ONLY the summary in the target language, no extra commentary.`;

/** Default settings, applied for any field that has never been set. */
export const DEFAULTS: Settings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  targetLang: 'zh-CN',
  triggerKey: 'Alt',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

/** Human-readable labels for common target language codes. */
const LANG_LABELS: Record<string, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
};

/** Human-readable label for a target language code, falling back to the code itself. */
export function langLabel(code: string): string {
  return LANG_LABELS[code] ?? code;
}

/**
 * Load settings from chrome.storage.local, merged over DEFAULTS so every field always
 * has a value. Uses chrome.storage.local exclusively (never sync) — see CFG-001.
 */
export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULTS, ...(stored ?? {}) };
}

/** Merge a partial patch into stored settings and persist to chrome.storage.local. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}