# config

设置持久化与默认值：`chrome.storage.local` 存储、内置默认 system prompt 与压缩 prompt、语言/触发键默认。

## Specs

- CFG-001 [PLAN] settings persistence: settings persist in chrome.storage.local (not synced) so the API key never enters Chrome sync.
- CFG-002 [PLAN] defaults: default target language zh-CN, default trigger key Alt, built-in default system prompt, built-in compress prompt.

## Settings schema

- `baseUrl`: string — OpenAI 兼容端点，如 `https://api.deepseek.com/v1`。
- `apiKey`: string — 仅 background 读取。
- `model`: string — 如 `deepseek-chat`。
- `targetLang`: string — 默认 `zh-CN`。
- `triggerKey`: string — 默认 `Alt`。
- `systemPrompt`: string — 默认见下，用户可覆盖。

## Built-in prompts

- **默认 system prompt**：指示 LLM 把用户给出的文本翻译成目标语言，只输出译文、不附前言或解释，并可利用对话中提供的背景上下文理解语境。
- **压缩 prompt**：指示 LLM 用目标语言总结当前网页的语境（话题、领域、已出现的术语与译法），用于辅助后续翻译，输出一段简洁总结。

两段具体文案在实现时定稿。system prompt 可被用户自定义覆盖；压缩 prompt 为内置常量（v1 不在设置页暴露）。