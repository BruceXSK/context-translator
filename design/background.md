# background

无状态 service worker：唯一持有 API key 的 LLM 调用入口，做流式 chat completions、用量回传、右键菜单注册与转发。

## Specs

- BG-001 [DONE] streaming LLM call: the service worker issues a chat completions request with streaming and forwards tokens as they arrive.
- BG-002 [DONE] API key custody: only the service worker reads the API key; it is never exposed to the content script or popup.
- BG-003 [DONE] selection context menu: the right-click menu offers "翻译" and "理解" on text selections.
- BG-004 [DONE] usage return: the service worker returns token usage from each completion, including DeepSeek cache-hit/miss fields when present.
- BG-005 [DONE] thinking + reasoning_effort in request body: the chat completions body always carries `thinking: {type:"enabled"|"disabled"}` (DeepSeek defaults to enabled when the field is omitted, so disabling must be explicit); when thinking is on it also carries `reasoning_effort: <effort>`.

## Responsibilities

- 接收 content/popup 的消息请求（翻译、压缩、菜单动作），自身不持有任何 session 状态。
- 翻译/压缩请求：从 config 读 `baseUrl`/`apiKey`/`model`/`thinking`/`effort`，以 `stream:true` 调 `/chat/completions`（请求体始终带 `thinking` 字段，开时再加 `reasoning_effort`），解析 SSE `data:` 行，逐 chunk 经消息通道转发给请求方；流结束后回传聚合后的 `usage`。
- 右键菜单：在 `selection` 上下文注册「翻译」「理解」；点击时把选区文本 + 动作类型发给当前 tab 的 content。
- 错误：HTTP 非 2xx / 网络失败 / SSE 解析失败时，把错误信息回传给请求方，由 content 原位展示并附重试。

## Messaging

流式场景用长连接 `chrome.runtime.Port` 逐 chunk 推送；一次性请求（如压缩也可走流式）与菜单动作可用普通 `chrome.runtime.sendMessage`。消息类型（请求/响应/chunk/error/usage）定义在 `src/shared/`，供 background、content、popup 共享。