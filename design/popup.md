# popup

插件弹窗：目标语言快速切换 + 打开设置页入口、手动上下文输入、当前页 token 用量展示、压缩/清空 session 动作。完整设置（端点 / API key / 模型 / 触发键 / system prompt）在独立设置页（POP-006）。

## Specs

- POP-001 [DONE] popup quick settings: the popup carries only the target-language selector (default zh-CN) and an entry to open the full settings page; it persists targetLang to chrome.storage.local. (Scope narrowed from the full settings form — base URL/API key/model/trigger key/system prompt moved to the options page, see POP-006.)
- POP-002 [PLAN] manual context input: a text input plus submit sends user-typed explanatory content to the active tab's pending-context buffer.
- POP-003 [PLAN] token usage display: show the active page's cumulative token usage, highlighting cache hit/miss when DeepSeek fields are present.
- POP-004 [PLAN] compress context action: a button triggers session compression on the active tab.
- POP-005 [PLAN] clear session action: a button resets the active tab's session.
- POP-006 [DONE] options page: a standalone settings page (open_in_tab) hosts base URL, API key, model, trigger key (a single-select of Alt/Shift/Ctrl, default Alt; stored as the standard KeyboardEvent.key name so the content-script key matcher hits), system prompt, a thinking toggle (switch style, default off; turning it on shows a notice toast warning that translations may stay on "Translating…" longer while the model thinks), and an effort single-select (segmented capsule, Low/Medium/High/Max, default Low, stored lowercase); when thinking is off the effort select is disabled and greyed. It reads/writes the same chrome.storage.local via the config module (shared schema with the popup), so changes take effect browser-wide — immediate for baseUrl/apiKey/model/thinking/effort (the stateless service worker reads them per request), while trigger key and system prompt apply to pages loaded after the change (the content script snapshots them on load).

## Layout

- 设置区：目标语言（POP-001）+ 打开设置页入口。
- 当前页区：token 用量（累计 prompt/completion，DeepSeek 时显示缓存命中/未命中）（POP-003）；「压缩上下文」「清空 session」按钮（POP-004 / POP-005）；「补充上下文」文本框 + 提交（POP-002）。
- 设置页（POP-006，独立 open_in_tab 页）：base URL / API key / model / 触发键 / 思考模式（开关，默认关；开启时弹通知提示翻译可能变慢）/ 思考强度（Low/Medium/High/Max 单选，默认 Low；思考模式关时禁用灰化）/ system prompt。

## Communication

通过 `chrome.tabs.query` 取当前活动 tab，经 `chrome.tabs.sendMessage` 与该页 content 通信（读取用量、提交上下文、触发压缩/清空）。目标语言写入 config（`chrome.storage.local`）。设置页（POP-006）直接读写 config 的 `chrome.storage.local`，不经 content；「打开设置」入口调 `chrome.runtime.openOptionsPage()`。