# Progress

## Current State

session 与 background 模块已实现并通过 typecheck + build（SES-001..005、BG-001..004 → DONE；background 已把 config 纳入 bundle）。下一个可 Chrome 验证的节点是 content（悬停翻译）。下一步：实现 content 模块（CT-001..009），完成后通知在 Chrome 中验证。

## Completed

- (session) src/session/index.ts：Session 类（turns + pending 缓冲、<context>/<user-instruction>/<translate> 折入、commit、压缩为摘要、用量累计）；SES-001..005 → DONE。运行时往返待 content 接线验证。
- (background) src/background/index.ts：Port 流式 chat completions（SSE 解析 + stream_options.include_usage）、API key 托管、右键菜单翻译/理解、DeepSeek 感知用量回传；BG-001..004 → DONE。运行时 LLM 往返待 content 接线验证。
- (config) src/config/index.ts：Settings schema、DEFAULTS、DEFAULT_SYSTEM_PROMPT、COMPRESS_PROMPT、langLabel、loadSettings/saveSettings（chrome.storage.local，不同步）；typecheck + build 绿。CFG-001/002 → DONE。端到端设置往返待 popup 接线（POP-001）时确认。
- (infra) scaffolded TS + Vite + @crxjs/vite-plugin MV3 骨架；typecheck + build 绿，dist/manifest.json 合规。ARCH-009 → DONE。
- (docs) 创建 DESIGN.md + design/{background,content,session,popup,config}.md + PROGRESS.md，写入 ARCH / BG / CT / SES / POP / CFG 全部 spec。

## Unresolved Problems

- 无。

## Spec Changes

- SES-002 (2026-06-25): `[背景]/[翻译]` markers → `<context>`/`<user-instruction>`/`<translate>` XML tags; pending split into context (from 理解) and instruction (from popup) kinds.