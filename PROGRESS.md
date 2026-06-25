# Progress

## Current State

config 模块已实现并通过 typecheck + build（CFG-001/002 → DONE）。SES-002 标记方案已采纳（spec change 已审计）。下一步：实现 background 模块（BG-001..004），随后 session → content → popup。（若想先验证纯逻辑、不依赖 API，可先做 session。）

## Completed

- (config) src/config/index.ts：Settings schema、DEFAULTS、DEFAULT_SYSTEM_PROMPT、COMPRESS_PROMPT、langLabel、loadSettings/saveSettings（chrome.storage.local，不同步）；typecheck + build 绿。CFG-001/002 → DONE。端到端设置往返待 popup 接线（POP-001）时确认。
- (infra) scaffolded TS + Vite + @crxjs/vite-plugin MV3 骨架；typecheck + build 绿，dist/manifest.json 合规。ARCH-009 → DONE。
- (docs) 创建 DESIGN.md + design/{background,content,session,popup,config}.md + PROGRESS.md，写入 ARCH / BG / CT / SES / POP / CFG 全部 spec。

## Unresolved Problems

- 无。

## Spec Changes

- SES-002 (2026-06-25): `[背景]/[翻译]` markers → `<context>`/`<user-instruction>`/`<translate>` XML tags; pending split into context (from 理解) and instruction (from popup) kinds.