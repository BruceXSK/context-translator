# Progress

## Current State

content 与 popup（设置表单 POP-001）已实现并通过 typecheck + build（11 模块）。这是第一个可在 Chrome 验证的节点。**等待你在 Chrome 中验证**：加载 dist → popup 填 API 配置 → 悬停段落轻按触发键 → 译文块；选定文字右键「翻译」→ 悬浮窗。验证通过后翻 CT-001..009、POP-001 为 DONE。

## Completed

- (content) src/content/index.ts：悬停 + solo-tap 触发（默认 Alt，可编辑元素内抑制）、段落抽取、译文块插入 + 三态切换 + 按段缓存、划线悬浮面板（单个/可拖拽/可关闭）、Shadow DOM + 构造样式表（编辑式批注美学）、流式渲染、原位错误 + 重试、session 持有、contextMenu/popup/compress 消息处理。CT-001..009 已实现，typecheck/build 绿，待 Chrome 验证。
- (popup) src/popup/index.html + main.ts：设置表单（base URL/API key/model/目标语言/触发键/system prompt），读写 chrome.storage.local。POP-001 已实现，typecheck/build 绿，待 Chrome 验证。
- (session) src/session/index.ts：Session 类（turns + pending 缓冲、<context>/<user-instruction>/<translate> 折入、commit、压缩为摘要、用量累计）；SES-001..005 → DONE。运行时往返待 content 接线验证。
- (background) src/background/index.ts：Port 流式 chat completions（SSE 解析 + stream_options.include_usage）、API key 托管、右键菜单翻译/理解、DeepSeek 感知用量回传；BG-001..004 → DONE。运行时 LLM 往返待 content 接线验证。
- (config) src/config/index.ts：Settings schema、DEFAULTS、DEFAULT_SYSTEM_PROMPT、COMPRESS_PROMPT、langLabel、loadSettings/saveSettings（chrome.storage.local，不同步）；typecheck + build 绿。CFG-001/002 → DONE。端到端设置往返待 popup 接线（POP-001）时确认。
- (infra) scaffolded TS + Vite + @crxjs/vite-plugin MV3 骨架；typecheck + build 绿，dist/manifest.json 合规。ARCH-009 → DONE。
- (docs) 创建 DESIGN.md + design/{background,content,session,popup,config}.md + PROGRESS.md，写入 ARCH / BG / CT / SES / POP / CFG 全部 spec。

## Unresolved Problems

- 无。

## Spec Changes

- SES-002 (2026-06-25): `[背景]/[翻译]` markers → `<context>`/`<user-instruction>`/`<translate>` XML tags; pending split into context (from 理解) and instruction (from popup) kinds.