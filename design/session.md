# session

页面级翻译 session 的数据模型与操作：消息序列、pending 上下文折入、响应提交、压缩为摘要、token 用量统计。

## Specs

- SES-001 [DONE] session message model: the session is [system, ...committed user/assistant turns] with pending context buffered separately.
- SES-002 [DONE] context folding: pending context has two kinds — context (from 理解) and instruction (user-typed via popup); a translation request assembles the user message as `<context>…</context>` and `<user-instruction>…</user-instruction>` blocks (omitting empties) followed by `<translate>{text}</translate>`, then clears pending. The first user message of a session-segment (no committed user turns — also the first after a compress or clear) also leads its `<user-instruction>` block with the persistent custom prompt (CFG-005), so the custom prompt appears once per segment rather than every turn; it is omitted when empty and reuses the existing <user-instruction> tag (no new tag).
- SES-003 [DONE] commit response: the completed assistant response is appended as a committed turn.
- SES-004 [DONE] compress: a preset prompt asks the LLM to summarize the page context; the summary (assistant) replaces committed history while the system prompt and pending context are preserved.
- SES-005 [DONE] token usage tracking: usage is accumulated per response (prompt/completion tokens, plus DeepSeek cache hit/miss when present) into a cumulative total, and the most recent translation response's usage is also snapshotted (compress responses update the cumulative total but do not replace the snapshot, so the popup's context gauge and Last cache rate reflect the last translation, not the compress meta-request). Both cumulative and last-translation usage are exposed for display (POP-003).
- SES-006 [DONE] re-translate request/commit: a re-translate builds a user message of `<user-instruction>\nre-translate\n</user-instruction>\n<translate>\n{text}\n</translate>` appended to the committed prefix (`[system, ...turns, {user}]`) — the prefix stays stable (DS-001) and the message may duplicate an earlier paragraph's translation in the history. Pending context is NOT touched and the custom prompt is NOT folded in (a re-translate is a correction within the current segment, where the custom prompt was already folded into the segment's first user message). On success, the user + assistant turns are appended (preserving the prefix for the next request), the last-translation usage snapshot is updated, and cumulative usage accumulates; pending is NOT cleared.

## Message shape

```
session = [ {role: system,    content: <system prompt + 权威声明> + "Target language: …"},
            {role: user,      content: "<context>…</context><user-instruction>{customPrompt + popup 指令}</user-instruction><translate>…</translate>"},  # 首条 user：<user-instruction> 块开头折入 customPrompt（空则省）；后续 user 不含 customPrompt
            {role: assistant, content: <translation>},
            ... ]
pending = [ {kind: 'context',     text: <理解选取的背景>},
            {kind: 'instruction', text: <popup 手输的解释>}, ... ]   # 尚未发出
customPrompt = <页内快照的用户补充指引>   # 持久字段，折入每个 segment 首条 user 消息（CFG-005）
```

## Operations

- **翻译请求**：把 pending 按 kind 渲染为 `<context>…</context>`（context 类，来自「理解」）与 `<user-instruction>…</user-instruction>`（instruction 类，来自 popup）块（空则省略），后接 `<translate>{text}</translate>`，组成新 user 消息 → 清空 pending → 追加 user 轮 → 发送 → 收到完整响应后追加 assistant 轮（SES-002 / SES-003）。**首条 user 消息**（无已提交 user 轮时——压缩/清空后下一条亦视为首条）还把页内快照的 `customPrompt` 拼到 `<user-instruction>` 块开头（CFG-005），每 segment 一次、避免每轮重复。
- **理解**：选区文字 push 为 `{kind:'context'}`；**手动上下文**（popup 输入）push 为 `{kind:'instruction'}`；均不立即发送。
- **压缩**：发预设 prompt（见 [config](./config.md)）让 LLM 总结本页语境；用返回的摘要作为 assistant 消息替换全部已提交历史，保留 system；pending 不动，留给压缩后下一次翻译（SES-004）。压缩后 session = `[system, {assistant, compact}, ...后续]`。
- **重翻译**（CT-016 / SES-006）：把待重翻段落的 skeleton 拼成 `<user-instruction>\nre-translate\n</user-instruction>\n<translate>\n{…}\n</translate>` 作为新 user 消息追加到已提交前缀末尾（`[system, ...turns, {user}]`，前缀稳定保 DS-001 缓存），不折入 pending、不折入 customPrompt（重翻译是 segment 内修正，customPrompt 已在首条折入）；成功后追加 user+assistant 轮、更新 last 快照、累计 usage，pending 不清。历史中可能存在该段的重复翻译条目（同一句多次重翻译）。
- **清空**：session 回到 `[system]`，pending 清空。
- **用量**：每次响应累计 `usage`；DeepSeek 响应含 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 时一并记录（SES-005）。累计存 cumulative，最近一次**翻译**响应另存 last 快照（压缩响应只进 cumulative、不替换 last），经 `getUsage()` 一并暴露供 popup（POP-003）。

## Cache rationale

不做滑动窗口截断：截断会改变对话前缀，使 prompt cache 每次失效。改为用户观察 token 用量后手动压缩；压缩后新前缀 `[system, compact]` 稳定，后续请求继续命中缓存。