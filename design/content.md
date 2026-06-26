# content

每页一份的 content script：持有本页 session 与 pending 上下文，负责悬停翻译、段落抽取、嵌入式译文块与三态显隐、划线悬浮窗、Shadow DOM UI、流式渲染与原位错误反馈。

## Specs

- CT-001 [DONE] hover trigger: pressing the configurable trigger key (default Alt) over a paragraph requests its translation; the trigger is suppressed inside editable elements.
- CT-002 [DONE] paragraph extraction: the translation unit is the text of the block/paragraph containing the cursor.
- CT-003 [DONE] embedded block translation with toggle: the first trigger fetches and inserts a translation block below the paragraph; later triggers toggle its visibility from cache without re-requesting.
- CT-004 [DONE] translation cache: completed translations are cached per paragraph so re-showing never re-requests.
- CT-005 [DONE] selection floating panel: a single reusable, draggable, closable panel near the selection shows the translation; each invocation is a fresh request with no caching.
- CT-006 [DONE] shadow-DOM UI isolation: the selection floating panel lives in a shadow DOM to isolate it from page styles; the embedded hover translation renders in the page DOM (no shadow) so it inherits the page's inline-element styling (links, code) and font.
- CT-007 [DONE] progressive streaming render: the translation UI updates as tokens arrive.
- CT-008 [DONE] session ownership: the content script holds the page's session message array and pending-context buffer.
- CT-009 [DONE] in-place error feedback: failures render in the translation area; the selection floating panel provides a retry control, and the embedded hover block retries by re-pressing the trigger key.
- CT-010 [DONE] source-matched inline translation: the embedded hover translation renders directly after the source text within the same paragraph, with no container box, background, border, or label; its typography (font, size, weight, style, color, line-height, spacing, alignment) inherits the source paragraph's styling via the page's CSS, and it is rendered slightly lighter than the source via a transparency effect, so it reads as a soft continuation of the page rather than an injected widget.
- CT-011 [DONE] inline-format-preserving translation: the hover translation preserves the source paragraph's inline elements; each inline element is replaced with a placeholder that keeps its real tag plus a data-ct-id attribute (no other attributes — href/class/data-*/style are not sent), and a shallow clone of the original (tag + attributes) is stored by id; the placeholder skeleton (text + real-tag placeholders, no original attributes) is sent to the LLM with a preserve-markup instruction (keep translated text inside each element, move elements as units); the returned HTML is sanitized (dangerous tags/handlers stripped) and each tagged element is swapped back for a clone of its original element (event handlers and dangerous URI schemes stripped) with recursively reconstructed translated children; if an original is missing or the output unsafe, the affected span falls back to plain text.
- CT-012 [DONE] hover loading placeholder: while a hover translation is in flight (before the first token), the embedded block shows a "Translating" placeholder followed by an animated braille spinner (10 frames ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, ~80ms each) at the position the translation will occupy; it is replaced by the streamed text as soon as the first chunk arrives, and cleared on done/error. The animation is driven by a timer (not CSS), since the block is light-DOM with no shadow (CT-010).
- CT-013 [DONE] line-clamp container compat: when a hovered paragraph's translation block would be clipped by an ancestor carrying `-webkit-line-clamp` (e.g. Google search snippets limited to N lines), showing the translation sets that ancestor's `-webkit-line-clamp` to `none` so the translation is visible; hiding restores the original value (re-set the recorded inline value, or remove the override so the class rule re-applies). The block itself stays `display:block` below the source. Mechanism confirmed against immersive-translate, which sets the same ancestor's clamp to `none`.
- CT-014 [DONE] no duplicate translation block: re-hovering an already-translated region (including after a `-webkit-line-clamp` container expands and shifts layout, or when a `-webkit-box` ancestor isn't matched as a block) toggles the existing block rather than creating a second one. `findParagraph` re-targets the existing `context-translator-block`'s paragraph (its `parentElement`) when a candidate block already contains a prior translation.
- CT-015 [DONE] skip same-language hover: when the hovered paragraph's text is already in the target language, the hover trigger does not send a translation request — no token spend, no session pollution, no DeepSeek cache-prefix disruption (DS-001). Detection runs client-side in `doToggle` before `toggleHover`, via two signals: (1) a matching `[lang]` attribute on the element/ancestor (exact match, or same primary subtag with no region variant on either side — so `zh` vs `zh` skips but `zh-TW` vs `zh-CN` does not, since Traditional→Simplified may still be meaningful); (2) otherwise a Unicode-script ratio test on the paragraph's plain text against the target language's primary script — Han majority with zero kana/hangul for `zh-*` (avoids ja/ko false hits), kana for `ja`, hangul for `ko`, Cyrillic for `ru`/`uk`/`be`/`bg`, Arabic for `ar`, Latin for the rest; an unknown target language never skips. Text with fewer than 4 judgeable characters is let through (translate rather than risk a false skip). The skip is silent — no UI feedback. Applies to hover translation only; selection-翻译 always sends (explicit user intent). Gated by CFG-004 (default on, not exposed in the settings UI in v1). Known limit: script alone cannot distinguish zh-CN from zh-TW, so Traditional Chinese aimed at a Simplified target may be skipped when the page lacks a precise `[lang]`.

## Hover translation flow

1. 监听 keydown（触发键，默认 Alt）并取当前鼠标位置所在段落；光标在 `input`/`textarea`/`contenteditable` 内时忽略。
2. 首次触发：抽取段落文本 → 经 session 模块组装消息 → 发给 background 流式翻译 → 在段落下方 Shadow DOM 插入译文块，逐 token 填充 → 完成后缓存译文、提交响应进 session。
3. 后续触发：切换译文块显/隐，使用缓存，不再请求、不改 session（纯软件行为）。

## Selection translation flow

右键菜单「翻译」→ 取选区文本 → 组装消息（无缓存）→ background 流式翻译 → 单个可复用悬浮面板（近选区、可拖动、可关闭）渐进显示 → 完成后提交响应进 session。

## UI isolation

译文块与悬浮面板都挂在 Shadow DOM 下，样式自包含，避免被宿主页 CSS 影响，也避免污染页面。