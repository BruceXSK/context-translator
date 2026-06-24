# content

每页一份的 content script：持有本页 session 与 pending 上下文，负责悬停翻译、段落抽取、嵌入式译文块与三态显隐、划线悬浮窗、Shadow DOM UI、流式渲染与原位错误反馈。

## Specs

- CT-001 [PLAN] hover trigger: pressing the configurable trigger key (default Alt) over a paragraph requests its translation; the trigger is suppressed inside editable elements.
- CT-002 [PLAN] paragraph extraction: the translation unit is the text of the block/paragraph containing the cursor.
- CT-003 [PLAN] embedded block translation with toggle: the first trigger fetches and inserts a translation block below the paragraph; later triggers toggle its visibility from cache without re-requesting.
- CT-004 [PLAN] translation cache: completed translations are cached per paragraph so re-showing never re-requests.
- CT-005 [PLAN] selection floating panel: a single reusable, draggable, closable panel near the selection shows the translation; each invocation is a fresh request with no caching.
- CT-006 [PLAN] shadow-DOM UI isolation: injected UI lives in a shadow DOM to isolate it from page styles.
- CT-007 [PLAN] progressive streaming render: the translation UI updates as tokens arrive.
- CT-008 [PLAN] session ownership: the content script holds the page's session message array and pending-context buffer.
- CT-009 [PLAN] in-place error feedback: failures render in the translation area with a retry control.

## Hover translation flow

1. 监听 keydown（触发键，默认 Alt）并取当前鼠标位置所在段落；光标在 `input`/`textarea`/`contenteditable` 内时忽略。
2. 首次触发：抽取段落文本 → 经 session 模块组装消息 → 发给 background 流式翻译 → 在段落下方 Shadow DOM 插入译文块，逐 token 填充 → 完成后缓存译文、提交响应进 session。
3. 后续触发：切换译文块显/隐，使用缓存，不再请求、不改 session（纯软件行为）。

## Selection translation flow

右键菜单「翻译」→ 取选区文本 → 组装消息（无缓存）→ background 流式翻译 → 单个可复用悬浮面板（近选区、可拖动、可关闭）渐进显示 → 完成后提交响应进 session。

## UI isolation

译文块与悬浮面板都挂在 Shadow DOM 下，样式自包含，避免被宿主页 CSS 影响，也避免污染页面。