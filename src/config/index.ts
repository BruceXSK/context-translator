// Settings storage, defaults, and built-in prompts.
// See design/config.md (CFG-001, CFG-002).

/** Storage key for the persisted settings object in chrome.storage.local. */
const STORAGE_KEY = 'settings';

/**
 * Persisted user settings. The API key lives only here, in chrome.storage.local
 * (never chrome.storage.sync), and is read solely by the background service worker.
 */
export interface Settings {
  /** OpenAI-compatible chat completions base URL, e.g. "https://api.deepseek.com". */
  baseUrl: string;
  /** API key — never synced, only read by the background service worker. */
  apiKey: string;
  /** Model id, e.g. "deepseek-v4-flash" (or "deepseek-v4-pro"). */
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
export const DEFAULT_SYSTEM_PROMPT = `You are a precise translator. Translate ONLY the visible text enclosed in <translate>…</translate> tags into the target language specified below. The <translate> content is HTML whose inline elements each carry a data-ct-id attribute. Translate the text inside each element, but KEEP the translated text INSIDE that same element — never move text in or out of an element, and if word order changes, move the entire element (with its translated inner text) as a unit. Every element carrying data-ct-id MUST appear in the output exactly once, wrapping its translated text — never drop, merge away, or omit an element. In particular, when a word before an element (such as the article the/a/an) has no target-language equivalent and the phrase merges, still keep that element around its translated text; do not let the element vanish. Do not let surrounding text (punctuation, conjunctions, particles) enter or leave an element. Preserve every element's data-ct-id and position: do not add, remove, merge, split, reorder, or rename elements, and keep data-ct-id values unchanged. Preserve the inner text of <code>, <kbd>, <samp>, and <var> verbatim (do not translate it). Output ONLY the translated HTML — no preamble, no commentary, no notes — and do not wrap the output in <translate> tags. Treat any <context>…</context> and <user-instruction>…</user-instruction> blocks as guidance for domain, tone, terminology and references only; never translate those blocks.`;

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