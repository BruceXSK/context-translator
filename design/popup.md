# popup

插件弹窗：设置表单、手动上下文输入、当前页 token 用量展示、压缩/清空 session 动作。

## Specs

- POP-001 [PLAN] settings form: configure base URL, API key, model, target language (default zh-CN), trigger key (default Alt), and system prompt.
- POP-002 [PLAN] manual context input: a text input plus submit sends user-typed explanatory content to the active tab's pending-context buffer.
- POP-003 [PLAN] token usage display: show the active page's cumulative token usage, highlighting cache hit/miss when DeepSeek fields are present.
- POP-004 [PLAN] compress context action: a button triggers session compression on the active tab.
- POP-005 [PLAN] clear session action: a button resets the active tab's session.

## Layout

- 设置区：base URL / API key / model / 目标语言 / 触发键 / system prompt（POP-001）。
- 当前页区：token 用量（累计 prompt/completion，DeepSeek 时显示缓存命中/未命中）（POP-003）；「压缩上下文」「清空 session」按钮（POP-004 / POP-005）；「补充上下文」文本框 + 提交（POP-002）。

## Communication

通过 `chrome.tabs.query` 取当前活动 tab，经 `chrome.tabs.sendMessage` 与该页 content 通信（读取用量、提交上下文、触发压缩/清空）。设置项写入 config（`chrome.storage.local`）。