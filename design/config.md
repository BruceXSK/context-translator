# config

设置持久化与默认值：`chrome.storage.local` 存储、内置默认 system prompt 与压缩 prompt、语言/触发键默认。

## Specs

- CFG-001 [DONE] settings persistence: settings persist in chrome.storage.local (not synced) so the API key never enters Chrome sync.
- CFG-002 [DONE] defaults: default target language zh-CN, default trigger key Alt, built-in default system prompt, built-in compress prompt.
- CFG-003 [DONE] thinking + effort settings: Settings carry a thinking toggle (boolean, default off) and an effort level (low/medium/high/max, default low), persisted in chrome.storage.local alongside the rest.

## Settings schema

- `baseUrl`: string — OpenAI 兼容端点，如 `https://api.deepseek.com`。
- `apiKey`: string — 仅 background 读取。
- `model`: string — 如 `deepseek-v4-flash`（或 `deepseek-v4-pro`）。
- `thinking`: boolean — DeepSeek 思考模式开关，默认关；开启时设置页弹出提示。
- `effort`: string — `low`/`medium`/`high`/`max`，默认 `low`；仅在 thinking 开时随请求发出。DeepSeek 仅 high/max 生效（low/medium 映射 high），全范围保留以兼容其他后端。
- `targetLang`: string — 默认 `zh-CN`。
- `triggerKey`: string — 默认 `Alt`。
- `systemPrompt`: string — 默认见下，用户可覆盖。

## Built-in prompts

- **默认 system prompt（`DEFAULT_SYSTEM_PROMPT`，用户可覆盖）**：

  ```text
  You are a precise translator. Translate ONLY the visible text enclosed in <translate>…</translate> tags into the target language specified below. The <translate> content is HTML whose inline elements each carry a data-ct-id attribute. Translate the text inside each element, but KEEP the translated text INSIDE that same element — never move text in or out of an element, and if word order changes, move the entire element (with its translated inner text) as a unit. Every element carrying data-ct-id MUST appear in the output exactly once, wrapping its translated text — never drop, merge away, or omit an element. In particular, when a word before an element (such as the article the/a/an) has no target-language equivalent and the phrase merges, still keep that element around its translated text; do not let the element vanish. Do not let surrounding text (punctuation, conjunctions, particles) enter or leave an element. Preserve every element's data-ct-id and position: do not add, remove, merge, split, reorder, or rename elements, and keep data-ct-id values unchanged. Preserve the inner text of <code>, <kbd>, <samp>, and <var> verbatim (do not translate it). Output ONLY the translated HTML — no preamble, no commentary, no notes — and do not wrap the output in <translate> tags. Treat any <context>…</context> and <user-instruction>…</user-instruction> blocks as guidance for domain, tone, terminology and references only; never translate those blocks.
  ```

- **压缩 prompt（`COMPRESS_PROMPT`，内置常量，v1 不在设置页暴露）**：

  ```text
  You are summarizing a translation session for one webpage. From the conversation above, produce a concise summary capturing the page's topic/domain and any terminology with their established translations — enough to keep future translations of this page consistent. Output ONLY the summary in the target language, no extra commentary.
  ```

目标语言不写进 system prompt；由 session 模块在组装 system 消息时追加 `Target language: <label>`（label 经 config 的 `langLabel` 由 `targetLang` 映射，如 `zh-CN` → Simplified Chinese）。system prompt 可被用户自定义覆盖；压缩 prompt 为内置常量。