# DESIGN

Global design: purpose, architecture, structure, modules index, and cross-cutting specs.

## Specs

- ARCH-001 [DONE] OpenAI-compatible LLM gateway: all LLM requests target a user-configured OpenAI-compatible chat completions endpoint.
- ARCH-002 [DONE] per-page session scope: a translation session is bound to a single page load, reset on reload, independent per tab.
- ARCH-003 [DONE] separation of state and transport: the service worker performs LLM HTTP calls and holds no session state; the content script owns the session.
- ARCH-004 [DONE] streaming output: translations display progressively as tokens arrive and commit to the session only once complete.
- ARCH-005 [DONE] context-folding protocol: "理解" and manual explanatory content buffer as pending context folded into the next translation request, preserving user/assistant alternation.
- ARCH-006 [DONE] cache-friendly session policy: the session is never auto-truncated; the user manually compresses context based on observed token usage.
- ARCH-007 [PLAN] compress-to-summary: compressing asks the LLM to summarize the page context; the session becomes system prompt + summary + subsequent messages.
- ARCH-008 [DONE] all-sites content injection: the content script runs on all URLs so hover translation works on any page.
- ARCH-009 [DONE] platform baseline: Manifest V3 built with TypeScript, Vite, and @crxjs/vite-plugin.
- ARCH-010 [DONE] markup-preserving translation output: the LLM returns the translated HTML preserving the inline-element markup (real tags + data-ct-id), with no preamble or explanation.
- ARCH-011 [DONE] translation direction: source language is auto-detected; target language is configurable with default Simplified Chinese.

## Purpose

一个基于 AI API 的 Chrome 翻译插件。鼠标悬停段落并按触发键（默认 ALT）即在段落下方嵌入显示译文；也可选定文字经右键菜单「翻译」在悬浮窗查看译文，或用「理解」把选定文字作为上下文喂给当前页 session。所有翻译共享一个按页面绑定的 session，累积上下文以帮助 LLM 理解语境；用户可手动补充解释、查看 token 用量并按需压缩上下文。

## Architecture

MV3 三层加一个配置模块：

- **content script（每页一份）**：持有本页 session 消息数组与 pending 上下文缓冲；负责悬停检测、段落抽取、译文块嵌入与三态显隐、划线悬浮窗、Shadow DOM UI、流式 DOM 更新、原位错误反馈。页面刷新即销毁，session 随之重置。
- **background service worker（无状态）**：唯一持有 API key 的入口，向 OpenAI 兼容端点发起 `stream:true` 的 chat completions 请求，解析 SSE 并逐 chunk 转发回 content，完成时回传 token usage（含 DeepSeek 缓存字段）。注册右键菜单「翻译」「理解」，点击后转发给当前 tab 的 content。
- **popup**：设置表单（base URL / key / model / 目标语言 / 触发键 / system prompt）、手动上下文输入、当前页 token 用量展示、压缩/清空 session 按钮。经 chrome.runtime 消息与当前 tab 的 content 通信。
- **config**：设置持久化于 `chrome.storage.local`（不同步，避免 key 进 Chrome sync），提供默认值与内置 system/compress prompt。

数据流：content 组装完整消息数组 → 发给 background → background 流式调用并回传 chunk + 最终 usage → content 渐进渲染、完成后提交响应进 session、累计 usage。压缩/手动上下文/清空由 popup 经消息触发 content 执行。

关键设计：session 不做滑动窗口截断以保 prompt cache 前缀稳定；由用户观察 token 用量后手动压缩，压缩以 assistant 摘要替换历史，新前缀 `[system, compact]` 稳定以继续命中缓存。

## Project Structure

```
context-translator/
├── DESIGN.md
├── PROGRESS.md
├── design/
│   ├── background.md
│   ├── content.md
│   ├── session.md
│   ├── popup.md
│   └── config.md
├── src/
│   ├── background/      # service worker
│   ├── content/         # content script + Shadow DOM UI
│   ├── popup/           # popup UI
│   ├── session/         # session model, context folding, compress, usage
│   ├── config/          # settings storage + defaults + prompts
│   └── shared/          # messaging protocol types
├── manifest.config.ts   # CRXJS manifest
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## Modules Index

| Module | Prefix | Design Doc |
|---|---|---|
| background | BG | [design/background.md](./design/background.md) |
| content | CT | [design/content.md](./design/content.md) |
| session | SES | [design/session.md](./design/session.md) |
| popup | POP | [design/popup.md](./design/popup.md) |
| config | CFG | [design/config.md](./design/config.md) |
| deepseek | DS | [design/deepseek.md](./design/deepseek.md) |

## troubleshooting

- **入口 basename 冲突（2026-06-25，已解决）：** background 与 content 入口必须用不同 basename。两者都叫 `index.ts` 时，Vite 产出两个 `index.ts-<hash>.js` chunk，CRXJS 把 `service-worker-loader.js` 错连到 content chunk——SW 跑了 content 的 `main()` → `document is not defined`（in promise）→ `onConnect` 未注册 → content 的 Port 一连即断（「与服务端的连接中断」）。改为 `src/background/sw.ts` 与 `src/content/inject.ts` 后修复。教训：扩展各入口文件 basename 必须唯一。