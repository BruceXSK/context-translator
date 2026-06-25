# config

设置持久化与默认值：`chrome.storage.local` 存储、内置默认 system prompt 与压缩 prompt、语言/触发键默认。

## Specs

- CFG-001 [DONE] settings persistence: settings persist in chrome.storage.local (not synced) so the API key never enters Chrome sync.
- CFG-002 [DONE] defaults: default target language zh-CN, default trigger key Alt, built-in default system prompt, built-in compress prompt.

## Settings schema

- `baseUrl`: string — OpenAI 兼容端点，如 `https://api.deepseek.com/v1`。
- `apiKey`: string — 仅 background 读取。
- `model`: string — 如 `deepseek-chat`。
- `targetLang`: string — 默认 `zh-CN`。
- `triggerKey`: string — 默认 `Alt`。
- `systemPrompt`: string — 默认见下，用户可覆盖。

## Built-in prompts

- **默认 system prompt（`DEFAULT_SYSTEM_PROMPT`，用户可覆盖）**：

  ```text
  You are a precise translator. Translate ONLY the text enclosed in <translate>…</translate> tags into the target language specified below. Output ONLY the translation — no preamble, no commentary, no notes. Treat any <context>…</context> and <user-instruction>…</user-instruction> blocks as guidance for domain, tone, terminology and references only; never translate those blocks. Preserve code, URLs and inline markup verbatim.
  ```

- **压缩 prompt（`COMPRESS_PROMPT`，内置常量，v1 不在设置页暴露）**：

  ```text
  You are summarizing a translation session for one webpage. From the conversation above, produce a concise summary capturing the page's topic/domain and any terminology with their established translations — enough to keep future translations of this page consistent. Output ONLY the summary in the target language, no extra commentary.
  ```

目标语言不写进 system prompt；由 session 模块在组装 system 消息时追加 `Target language: <label>`（label 经 config 的 `langLabel` 由 `targetLang` 映射，如 `zh-CN` → Simplified Chinese）。system prompt 可被用户自定义覆盖；压缩 prompt 为内置常量。