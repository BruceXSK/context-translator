# session

页面级翻译 session 的数据模型与操作：消息序列、pending 上下文折入、响应提交、压缩为摘要、token 用量统计。

## Specs

- SES-001 [DONE] session message model: the session is [system, ...committed user/assistant turns] with pending context buffered separately.
- SES-002 [DONE] context folding: pending context has two kinds — context (from 理解) and instruction (user-typed via popup); a translation request assembles the user message as `<context>…</context>` and `<user-instruction>…</user-instruction>` blocks (omitting empties) followed by `<translate>{text}</translate>`, then clears pending.
- SES-003 [DONE] commit response: the completed assistant response is appended as a committed turn.
- SES-004 [DONE] compress: a preset prompt asks the LLM to summarize the page context; the summary (assistant) replaces committed history while the system prompt and pending context are preserved.
- SES-005 [DONE] token usage tracking: usage is accumulated per response (prompt/completion tokens, plus DeepSeek cache hit/miss when present) and exposed for display.

## Message shape

```
session = [ {role: system,    content: <system prompt>},
            {role: user,      content: "<context>…</context><user-instruction>…</user-instruction><translate>…</translate>"},  # 折入 pending 后（空块省略）
            {role: assistant, content: <translation>},
            ... ]
pending = [ {kind: 'context',     text: <理解选取的背景>},
            {kind: 'instruction', text: <popup 手输的解释>}, ... ]   # 尚未发出
```

## Operations

- **翻译请求**：把 pending 按 kind 渲染为 `<context>…</context>`（context 类，来自「理解」）与 `<user-instruction>…</user-instruction>`（instruction 类，来自 popup）块（空则省略），后接 `<translate>{text}</translate>`，组成新 user 消息 → 清空 pending → 追加 user 轮 → 发送 → 收到完整响应后追加 assistant 轮（SES-002 / SES-003）。
- **理解**：选区文字 push 为 `{kind:'context'}`；**手动上下文**（popup 输入）push 为 `{kind:'instruction'}`；均不立即发送。
- **压缩**：发预设 prompt（见 [config](./config.md)）让 LLM 总结本页语境；用返回的摘要作为 assistant 消息替换全部已提交历史，保留 system；pending 不动，留给压缩后下一次翻译（SES-004）。压缩后 session = `[system, {assistant, compact}, ...后续]`。
- **清空**：session 回到 `[system]`，pending 清空。
- **用量**：每次响应累计 `usage`；DeepSeek 响应含 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 时一并记录（SES-005）。

## Cache rationale

不做滑动窗口截断：截断会改变对话前缀，使 prompt cache 每次失效。改为用户观察 token 用量后手动压缩；压缩后新前缀 `[system, compact]` 稳定，后续请求继续命中缓存。