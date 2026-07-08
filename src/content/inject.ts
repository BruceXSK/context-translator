// Content script: per-page session owner + hover/selection translation UI.
// See design/content.md (CT-001 .. CT-011).
import { loadSettings, type Settings } from '../config';
import { Session } from '../session';
import type { ChatMessage, RuntimeRequest, StreamEvent, Usage } from '../shared/messages';
import DOMPurify from 'dompurify';

const PORT_NAME = 'llm-stream';
const MAX_PARA_CHARS = 3000;
const BLOCK_TAGS = new Set([
  'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TD', 'TH', 'DT', 'DD', 'FIGCAPTION', 'SUMMARY', 'PRE',
]);

// ---------- styles (shared constructable stylesheet) ----------
const STYLE_TEXT = `
:host{
  --ct-paper:#fbf8f1;--ct-paper-2:#f3ecdd;--ct-ink:#2b2620;--ct-ink-soft:#6f6557;
  --ct-accent:#9a6a2f;--ct-error:#9a3b32;--ct-rule:#e8ddc7;
  --ct-radius:7px;--ct-panel-radius:12px;
  --ct-shadow-block:0 1px 2px rgba(40,32,20,.06);
  --ct-shadow-panel:0 12px 34px rgba(40,32,20,.22),0 2px 8px rgba(40,32,20,.14);
  --ct-serif:'Iowan Old Style','Palatino Linotype',Palatino,'Hoefler Text',Georgia,'Times New Roman',serif;
  --ct-sans:'Avenir Next','Avenir','Segoe UI',system-ui,sans-serif;
  all:initial;box-sizing:border-box;font-family:var(--ct-serif);color:var(--ct-ink);line-height:1.6;
}
.ct-eyebrow{display:block;font-family:var(--ct-sans);font-size:.6875rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ct-accent);margin-bottom:4px;font-weight:600}
.ct-text{margin:0;white-space:pre-wrap;word-break:break-word;min-height:1.1em}
.ct-text.ct-streaming::after{content:"▌";display:inline-block;margin-left:1px;color:var(--ct-accent);animation:ct-blink 1s steps(2) infinite}
.ct-panel{width:min(420px,86vw);background:var(--ct-paper);border:1px solid var(--ct-rule);
  border-radius:var(--ct-panel-radius);box-shadow:var(--ct-shadow-panel);overflow:hidden;animation:ct-rise .16s ease-out}
.ct-panel-head{display:flex;align-items:center;justify-content:space-between;padding:7px 10px 7px 13px;
  background:var(--ct-paper-2);cursor:grab;border-bottom:1px solid var(--ct-rule);user-select:none}
.ct-panel-head:active{cursor:grabbing}
.ct-panel-head .ct-eyebrow{margin:0}
.ct-panel-body{padding:11px 15px 13px}
.ct-close{all:unset;font-family:var(--ct-sans);font-size:.9rem;line-height:1;width:22px;height:22px;
  display:grid;place-items:center;color:var(--ct-ink-soft);border-radius:5px;cursor:pointer}
.ct-close:hover{background:rgba(0,0,0,.06);color:var(--ct-ink)}
.ct-panel .ct-text{font-size:1rem}
.ct-error{margin:9px 0 0;padding:7px 10px;border-radius:6px;background:rgba(154,59,50,.09);color:var(--ct-error);
  font-family:var(--ct-sans);font-size:.8125rem;display:flex;align-items:center;gap:10px}
.ct-error[hidden]{display:none}
.ct-retry{all:unset;font-family:var(--ct-sans);font-size:.8125rem;color:var(--ct-accent);cursor:pointer;
  border-bottom:1px solid currentColor;padding-bottom:1px;white-space:nowrap}
.ct-retry:hover{color:var(--ct-ink)}
@keyframes ct-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes ct-blink{50%{opacity:0}}
`;

let sharedSheet: CSSStyleSheet | null = null;
function sheet(): CSSStyleSheet {
  if (!sharedSheet) {
    sharedSheet = new CSSStyleSheet();
    sharedSheet.replaceSync(STYLE_TEXT);
  }
  return sharedSheet;
}
function shadowOf(host: HTMLElement): ShadowRoot {
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [sheet()];
  return root;
}

// ---------- streaming client (content -> background over a Port) ----------
interface Handlers {
  onChunk: (full: string) => void;
  onDone: (full: string, usage: Usage) => void;
  onError: (msg: string) => void;
}
let reqCounter = 0;
function stream(kind: 'translate' | 'compress', messages: ChatMessage[], h: Handlers): void {
  const port = chrome.runtime.connect({ name: PORT_NAME });
  const requestId = String(++reqCounter);
  let buffer = '';
  let settled = false;
  const done = () => { settled = true; try { port.disconnect(); } catch { /* already closed */ } };
  port.onMessage.addListener((evt: StreamEvent) => {
    if (evt.requestId !== requestId || settled) return;
    if (evt.kind === 'chunk') { buffer += evt.delta; h.onChunk(buffer); }
    else if (evt.kind === 'done') { settled = true; h.onDone(evt.fullText || buffer, evt.usage); try { port.disconnect(); } catch { /* closed */ } }
    else if (evt.kind === 'error') { settled = true; h.onError(evt.message); try { port.disconnect(); } catch { /* closed */ } }
  });
  port.onDisconnect.addListener(() => { if (!settled) { settled = true; h.onError('与服务端的连接中断'); } });
  port.postMessage({ kind, requestId, messages });
}

// ---------- html skeletonization + reconstruction (CT-011) ----------
// Inline elements are replaced with <x data-ct-id data-ct-tag> placeholders so the LLM only
// sees text + minimal markers (no original attributes are sent). On return, each <x> is swapped
// back for a clone of its original element (event handlers / dangerous URIs stripped) with
// translated children — so links/code keep the page's styling and attributes (CT-010).
function stripTags(s: string): string {
  return s.replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// CT-015: skip hover translation when the paragraph is already in the target language.
// A pure Unicode-script ratio test on the paragraph's plain text decides whether the content's
// script matches the target language's primary script (Han for zh-*, kana for ja, hangul for ko,
// Cyrillic, Arabic, Latin for the rest; unknown target never skips). The [lang] attribute is
// intentionally NOT consulted — closest('[lang]') can climb to a page-level tag that does not
// describe the paragraph (e.g. GitHub's <html lang="en"> over a Chinese README, which wrongly
// forced translation of Chinese), and same-script languages cannot be reliably told apart by lang
// anyway. Silent — no UI feedback. Hover only; gated by skipSameLang (CFG-004).
function looksLikeTargetLang(text: string, targetLang: string): boolean {
  const target = (targetLang || '').toLowerCase();
  if (!target) return false;
  const judgeable = text.replace(/[\s\p{P}\p{S}]/gu, '');
  const c = countScripts(judgeable);
  const total = judgeable.length;
  switch (target.split('-')[0]) {
    case 'zh': // Han > 20% with no kana/hangul → Chinese. Low threshold so CJK-heavy mixed
      // Chinese/English text still skips; zero kana/hangul avoids ja/ko false hits.
      return c.han > total * 0.2 && c.kana === 0 && c.hangul === 0;
    case 'ja':
      return c.kana > 0;
    case 'ko':
      return c.hangul > total * 0.3;
    case 'ru': case 'uk': case 'be': case 'bg':
      return c.cyrillic > total * 0.5;
    case 'ar':
      return c.arabic > total * 0.5;
    default: // Latin-family (en/fr/de/es/...). Match when Latin dominates and no CJK.
      return c.latin > total * 0.5 && c.han === 0 && c.kana === 0 && c.hangul === 0;
  }
}

function countScripts(s: string): { han: number; kana: number; hangul: number; latin: number; cyrillic: number; arabic: number } {
  const c = { han: 0, kana: 0, hangul: 0, latin: 0, cyrillic: 0, arabic: 0 };
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)) c.han++;
    else if ((cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff)) c.kana++;
    else if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff)) c.hangul++;
    else if ((cp >= 0x0041 && cp <= 0x005a) || (cp >= 0x0061 && cp <= 0x007a) || (cp >= 0x00c0 && cp <= 0x024f)) c.latin++;
    else if (cp >= 0x0400 && cp <= 0x04ff) c.cyrillic++;
    else if (cp >= 0x0600 && cp <= 0x06ff) c.arabic++;
  }
  return c;
}

/** Replace each element under `root` with an <x data-ct-id data-ct-tag> placeholder (nested for
 *  nested elements), storing a shallow clone (tag + attributes) of each original by id. */
function extractSkeleton(root: Element): { skeleton: string; originals: Map<number, Element> } {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('context-translator-block, .notranslate').forEach((n) => n.remove());
  const originals = new Map<number, Element>();
  const counter = { n: 0 };
  const frag = document.createDocumentFragment();
  for (const child of Array.from(clone.childNodes)) frag.appendChild(toSkeleton(child, originals, counter));
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  return { skeleton: wrap.innerHTML.slice(0, MAX_PARA_CHARS), originals };
}

function toSkeleton(node: Node, originals: Map<number, Element>, counter: { n: number }): Node {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode(false);
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const id = ++counter.n;
    originals.set(id, el.cloneNode(false) as Element); // tag + attributes; children replaced on reconstruct
    // Placeholder keeps the REAL tag (so the LLM treats it semantically — e.g. keeps a link's
    // text together and moves it as a unit) but carries only a data-ct-id; no original
    // attributes (href/class/data-*/style/…) are sent to the LLM (CT-011).
    const ph = document.createElement(el.tagName);
    ph.setAttribute('data-ct-id', String(id));
    for (const c of Array.from(el.childNodes)) ph.appendChild(toSkeleton(c, originals, counter));
    return ph;
  }
  return document.createTextNode(''); // drop comments / processing instructions
}

/** Sanitize the LLM's returned HTML to safe inline tags carrying data-ct-id + text (scripts,
 *  handlers, style, etc. stripped), then swap each tagged element back for a clone of its
 *  original element with recursively reconstructed children. */
function reconstruct(dirty: string, originals: Map<number, Element>): string {
  const clean = DOMPurify.sanitize(dirty, {
    FORBID_TAGS: ['script','style','iframe','object','embed','form','input','button','link','meta','base','frame','frameset','applet','marquee','svg','math','noscript','template','title','textarea','select','option'],
    ALLOW_DATA_ATTR: true,
  });
  const wrap = document.createElement('div');
  wrap.innerHTML = clean;
  const out = document.createDocumentFragment();
  for (const child of Array.from(wrap.childNodes)) out.appendChild(reconstructNode(child, originals));
  const result = document.createElement('div');
  result.appendChild(out);
  return result.innerHTML;
}

function reconstructNode(node: Node, originals: Map<number, Element>): Node {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode(false);
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const original = originals.get(Number(el.getAttribute('data-ct-id')));
    if (original) {
      const clone = original.cloneNode(false) as Element;
      sanitizeClone(clone);
      for (const c of Array.from(el.childNodes)) clone.appendChild(reconstructNode(c, originals));
      return clone;
    }
    return document.createTextNode(el.textContent ?? ''); // no/unknown id → plain text fallback
  }
  return document.createTextNode('');
}

/** Strip event-handler attributes and dangerous URI schemes from a reused original element. */
function sanitizeClone(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
    } else if (name === 'href' || name === 'xlink:href') {
      if (/^\s*(javascript|vbscript|file|data):/i.test(attr.value)) el.removeAttribute(attr.name);
    } else if (name === 'src') {
      if (/^\s*(javascript|vbscript|file):/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
}

// ---------- views ----------
interface View {
  start(): void;
  setChunk(full: string): void;
  done(full: string): void;
  error(msg: string, onRetry: () => void): void;
}

class BlockView implements View {
  readonly host: HTMLElement;
  private textEl: HTMLElement;
  private errorEl: HTMLElement;
  private retransBtn: HTMLElement;
  private readonly originals: Map<number, Element>;
  // CT-016: re-translate button bound after the view is attached to a paragraph.
  private onRetranslate: (() => void) | null = null;
  // CT-012: animated "Translating…" placeholder shown from start() until the first chunk.
  // Driven by a timer (not CSS @keyframes) because the block is light-DOM with no shadow
  // (CT-010): a global <style> would collide with / leak into the host page.
  private static readonly SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'; // 10-frame braille spinner — zero CSS, ASCII-free
  private waitTimer: number | null = null;
  private waitFrame = 0;
  constructor(originals: Map<number, Element>) {
    this.originals = originals;
    this.host = document.createElement('context-translator-block');
    // No shadow DOM: the translation renders as light-DOM children so the page's own CSS
    // styles its inline elements (links, code) and supplies the font (CT-010/CT-011).
    // Layout is pinned via inline styles; the translation text is dimmed via opacity.
    this.host.style.cssText = 'display:block;margin:0;box-sizing:border-box';
    this.host.innerHTML =
      '<span class="ct-text" style="opacity:.85"></span>' +
      '<span class="ct-error" hidden style="color:#9a3b32"></span>';
    this.textEl = this.host.querySelector<HTMLElement>('.ct-text')!;
    this.errorEl = this.host.querySelector<HTMLElement>('.ct-error')!;
    // CT-016: a small "re-translate" icon button appended after the translation. Light-DOM,
    // all inline styles (no shadow to scope a class rule, same constraint as the spinner).
    // ↻ = U+21BB CLOCKWISE OPEN CIRCLE ARROW. Hidden until a translation completes.
    this.retransBtn = document.createElement('span');
    this.retransBtn.className = 'ct-retrans';
    this.retransBtn.textContent = '↻';
    this.retransBtn.title = '重新翻译';
    this.retransBtn.setAttribute('aria-label', '重新翻译');
    this.retransBtn.setAttribute('role', 'button');
    this.retransBtn.tabIndex = 0;
    this.retransBtn.style.cssText =
      'display:none;cursor:pointer;margin-left:.45em;font-size:.85em;opacity:.4;' +
      'user-select:none;vertical-align:baseline;line-height:1';
    this.host.appendChild(this.retransBtn);
    this.retransBtn.addEventListener('mouseenter', () => { this.retransBtn.style.opacity = '.7'; });
    this.retransBtn.addEventListener('mouseleave', () => { this.retransBtn.style.opacity = '.4'; });
    this.retransBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      this.onRetranslate?.();
    });
    this.retransBtn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.onRetranslate?.();
      }
    });
  }
  /** Bind the re-translate action for this block (called once the owning paragraph is known). */
  setRetranslateHandler(fn: () => void): void { this.onRetranslate = fn; }
  showRetranslate(): void { this.retransBtn.style.display = 'inline'; }
  hideRetranslate(): void { this.retransBtn.style.display = 'none'; }
  start() {
    this.errorEl.hidden = true;
    this.stopWaiting();
    this.waitFrame = 0;
    this.textEl.textContent = 'Translating ' + BlockView.SPINNER[0];
    this.waitTimer = window.setInterval(() => {
      this.waitFrame = (this.waitFrame + 1) % BlockView.SPINNER.length; // 10-frame loop
      this.textEl.textContent = 'Translating ' + BlockView.SPINNER[this.waitFrame];
    }, 80);
    this.hideRetranslate();
  }
  setChunk(full: string) { this.stopWaiting(); this.textEl.textContent = stripTags(full); }
  done(full: string) {
    this.stopWaiting();
    const html = reconstruct(full, this.originals);
    this.textEl.innerHTML = html || stripTags(full); // fallback to plain text if reconstruction yields nothing
    this.showRetranslate();
  }
  error(msg: string, _onRetry: () => void) {
    this.stopWaiting();
    this.textEl.textContent = '';
    this.errorEl.textContent = msg;
    this.errorEl.hidden = false;
    // The re-translate button's visibility is left to the caller: on a first-translation error
    // it stays hidden (nothing to re-do); on a re-translate error the caller re-shows it so the
    // user can retry. Either way the button is not toggled here.
  }
  private stopWaiting(): void {
    if (this.waitTimer !== null) { window.clearInterval(this.waitTimer); this.waitTimer = null; }
  }
}

class PanelView implements View {
  readonly host: HTMLElement;
  private textEl: HTMLElement;
  private errMsg: HTMLElement;
  private errorEl: HTMLElement;
  private retryBtn: HTMLElement;
  private head: HTMLElement;
  constructor() {
    this.host = document.createElement('context-translator-panel');
    this.host.style.cssText = 'all:initial;display:block;position:fixed;z-index:2147483647;box-sizing:border-box';
    this.host.style.display = 'none';
    const root = shadowOf(this.host);
    root.innerHTML =
      '<div class="ct-panel"><div class="ct-panel-head"><span class="ct-eyebrow">译文</span>' +
      '<button class="ct-close">✕</button></div><div class="ct-panel-body"><p class="ct-text"></p>' +
      '<div class="ct-error" hidden><span class="ct-err-msg"></span><button class="ct-retry">重试</button></div></div></div>';
    this.textEl = root.querySelector<HTMLElement>('.ct-text')!;
    this.errMsg = root.querySelector<HTMLElement>('.ct-err-msg')!;
    this.errorEl = root.querySelector<HTMLElement>('.ct-error')!;
    this.retryBtn = root.querySelector<HTMLElement>('.ct-retry')!;
    this.head = root.querySelector<HTMLElement>('.ct-panel-head')!;
    root.querySelector<HTMLElement>('.ct-close')!.addEventListener('click', () => this.hide());
    this.makeDraggable();
  }
  show(x: number, y: number): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(420, vw * 0.86);
    const left = Math.max(8, Math.min(x, vw - w - 8));
    const top = Math.max(8, Math.min(y, vh - 140));
    this.host.style.left = `${left}px`;
    this.host.style.top = `${top}px`;
    this.host.style.display = 'block';
  }
  hide(): void { this.host.style.display = 'none'; }
  start() { this.textEl.textContent = ''; this.textEl.classList.add('ct-streaming'); this.errorEl.hidden = true; this.host.style.display = 'block'; }
  setChunk(full: string) { this.textEl.textContent = full; }
  done(full: string) { this.textEl.textContent = full; this.textEl.classList.remove('ct-streaming'); }
  error(msg: string, onRetry: () => void) {
    this.textEl.classList.remove('ct-streaming');
    this.errMsg.textContent = msg;
    this.errorEl.hidden = false;
    this.retryBtn.onclick = onRetry;
  }
  private makeDraggable(): void {
    let dragging = false;
    let offX = 0;
    let offY = 0;
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      this.host.style.left = `${e.clientX - offX}px`;
      this.host.style.top = `${e.clientY - offY}px`;
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    this.head.addEventListener('mousedown', (e: MouseEvent) => {
      dragging = true;
      offX = e.clientX - parseFloat(this.host.style.left || '0');
      offY = e.clientY - parseFloat(this.host.style.top || '0');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

// ---------- helpers ----------
function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable;
}

interface ParaHit {
  el: Element;
  skeleton: string;
  originals: Map<number, Element>;
}
function findParagraph(el: Element | null): ParaHit | null {
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    // Skip our own injected translation so hovering the translation finds the paragraph.
    const own = node.closest('context-translator-block');
    if (own) { node = own.parentElement; continue; }
    const direct = BLOCK_TAGS.has(node.tagName);
    const display = direct ? 'block' : getComputedStyle(node).display;
    if (direct || display === 'block' || display === 'list-item' || display === 'table-cell' || display === 'flow-root') {
      // CT-014: if this block already contains a translation (e.g. after a -webkit-line-clamp
      // container expanded and shifted layout, or a -webkit-box ancestor wasn't matched as a
      // block and we climbed past the real paragraph), re-target that translation's paragraph
      // so we toggle it instead of creating a duplicate block.
      const existing = node.querySelector('context-translator-block');
      if (existing) {
        const parent = existing.parentElement;
        if (parent && parent !== document.body && parent !== document.documentElement) {
          const { skeleton, originals } = extractSkeleton(parent);
          if (skeleton) return { el: parent, skeleton, originals };
        }
      }
      const { skeleton, originals } = extractSkeleton(node);
      if (skeleton) return { el: node, skeleton, originals };
    }
    node = node.parentElement;
  }
  return null;
}

function selectionRect(): DOMRect | null {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (r.width || r.height) return r;
  }
  return null;
}

// ---------- main ----------
async function main(): Promise<void> {
  const settings: Settings = await loadSettings();
  const session = new Session(settings.targetLang, settings.customPrompt);
  const triggerKey = settings.triggerKey || 'Alt';
  const panel = new PanelView();
  (document.body || document.documentElement).appendChild(panel.host);

  interface ParaState {
    view: BlockView;
    translation: string;
    // CT-016: the paragraph's skeleton (placeholder HTML) cached at first translation so a
    // re-translate can rebuild the message array without re-extracting the (possibly mutated) DOM.
    skeleton: string;
    status: 'loading' | 'shown' | 'hidden';
    // CT-013: nearest ancestor with -webkit-line-clamp that would clip the translation block,
    // plus its original inline value so we can restore it (re-set, or remove to re-enable a class rule).
    clampEl: HTMLElement | null;
    clampOrigInline: string;
  }
  const paraState = new WeakMap<Element, ParaState>();

  // cursor tracking (cheap: just store coords)
  let mx = -1;
  let my = -1;
  document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });

  // tap-trigger semantics: trigger only on a solo tap of the trigger key (no other key/mouse/modifier)
  const TK = triggerKey.toLowerCase();
  const triggerIsMod = TK === 'alt' || TK === 'control' || TK === 'shift' || TK === 'meta';
  const matches = (e: KeyboardEvent): boolean => e.key.toLowerCase() === TK || e.code === triggerKey;
  const isBare = (e: KeyboardEvent): boolean => {
    if (!triggerIsMod) return !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    return !((TK !== 'alt' && e.altKey) || (TK !== 'control' && e.ctrlKey) || (TK !== 'shift' && e.shiftKey) || (TK !== 'meta' && e.metaKey));
  };
  let held = false;
  let solo = false;
  document.addEventListener('keydown', (e) => {
    if (matches(e)) { if (!e.repeat) { held = true; solo = true; } }
    else if (held) { solo = false; }
  });
  document.addEventListener('mousedown', () => { if (held) solo = false; });
  document.addEventListener('keyup', (e) => {
    if (!matches(e) || !held) return;
    const wasSolo = solo;
    held = false;
    solo = false;
    if (wasSolo && isBare(e)) doToggle();
  });

  function doToggle(): void {
    if (mx < 0) return;
    const target = document.elementFromPoint(mx, my);
    if (!target || isEditable(target)) return;
    const hit = findParagraph(target);
    if (!hit) return;
    // CT-015: silently skip when the paragraph is already in the target language.
    if (settings.skipSameLang && looksLikeTargetLang(stripTags(hit.skeleton), settings.targetLang)) return;
    toggleHover(hit.el, hit.skeleton, hit.originals);
  }

  // CT-013: find the nearest ancestor (including el) whose -webkit-line-clamp would clip the
  // translation block. Google search snippets (.VwiC3b) clamp to N lines; without this the
  // translation renders in the DOM but is visually clipped ("translates but doesn't show").
  function findClamp(el: Element): HTMLElement | null {
    let n: Element | null = el;
    while (n && n !== document.body && n !== document.documentElement) {
      if (n instanceof HTMLElement) {
        const clamp = getComputedStyle(n).getPropertyValue('-webkit-line-clamp');
        if (clamp && clamp !== 'none') return n;
      }
      n = n.parentElement;
    }
    return null;
  }
  // Open: set the clamp ancestor's line-clamp to none so the translation shows. Close: restore the
  // recorded original — re-set it if the clamp came from an inline style, or remove the override so a
  // class rule re-applies. (removeProperty alone would drop an original inline value like "2".)
  function setClamp(st: ParaState, open: boolean): void {
    if (!st.clampEl) return;
    if (open) st.clampEl.style.setProperty('-webkit-line-clamp', 'none');
    else if (st.clampOrigInline === '') st.clampEl.style.removeProperty('-webkit-line-clamp');
    else st.clampEl.style.setProperty('-webkit-line-clamp', st.clampOrigInline);
  }
  function toggleHover(el: Element, skeleton: string, originals: Map<number, Element>): void {
    let st = paraState.get(el);
    if (!st) {
      const clampEl = findClamp(el);
      st = {
        view: new BlockView(originals),
        translation: '',
        skeleton,
        status: 'hidden',
        clampEl,
        clampOrigInline: clampEl ? clampEl.style.getPropertyValue('-webkit-line-clamp') : '',
      };
      paraState.set(el, st);
      el.appendChild(st.view.host);
      // CT-016: wire the re-translate button to this paragraph's state once it's known.
      const retrans = () => reFetchHover(el, st!);
      st.view.setRetranslateHandler(retrans);
    }
    if (st.status === 'shown') { setClamp(st, false); st.view.host.style.display = 'none'; st.status = 'hidden'; return; }
    if (st.status === 'hidden' && st.translation) { setClamp(st, true); st.view.host.style.display = 'block'; st.status = 'shown'; return; }
    fetchHover(el, skeleton, st);
  }

  function fetchHover(el: Element, skeleton: string, st: ParaState): void {
    st.status = 'loading';
    st.view.host.style.display = 'block';
    setClamp(st, true);
    st.view.start();
    stream('translate', session.buildTranslateRequest(skeleton), {
      onChunk: (full) => st.view.setChunk(full),
      onDone: (full, usage) => {
        st.translation = full;
        st.view.done(full);
        st.status = 'shown';
        session.commitResponse(full, usage);
      },
      onError: (msg) => {
        st.status = 'shown';
        st.view.error(msg, () => fetchHover(el, skeleton, st));
      },
    });
  }

  // CT-016: re-translate an already-translated paragraph on demand. Mirrors fetchHover but
  // builds a re-translate request (a <user-instruction> re-translate </user-instruction> marker
  // plus the same <translate> skeleton, appended to the committed prefix — DS-001 stays stable)
  // and commits via commitRetranslate (appends user+assistant turns, updates lastUsage, does NOT
  // clear pending). On error the old translation is cleared and the error is shown in place; the
  // re-translate button stays visible so the user can retry. Bypasses the CT-015 same-language
  // skip (explicit user intent).
  function reFetchHover(el: Element, st: ParaState): void {
    st.translation = '';
    st.status = 'loading';
    st.view.host.style.display = 'block';
    setClamp(st, true);
    st.view.start();
    stream('translate', session.buildRetranslateRequest(st.skeleton), {
      onChunk: (full) => st.view.setChunk(full),
      onDone: (full, usage) => {
        st.translation = full;
        st.view.done(full);
        st.status = 'shown';
        session.commitRetranslate(full, usage);
      },
      onError: (msg) => {
        st.status = 'shown';
        st.view.error(msg, () => reFetchHover(el, st));
        st.view.showRetranslate();
      },
    });
  }

  function selectionTranslate(text: string): void {
    const rect = selectionRect();
    panel.start();
    panel.show(rect ? rect.left : mx, rect ? rect.bottom + 10 : my);
    stream('translate', session.buildTranslateRequest(text), {
      onChunk: (full) => panel.setChunk(full),
      onDone: (full, usage) => { panel.done(full); session.commitResponse(full, usage); },
      onError: (msg) => panel.error(msg, () => selectionTranslate(text)),
    });
  }

  function doCompress(sendResponse: (r: unknown) => void): void {
    panel.start();
    panel.show(mx < 0 ? window.innerWidth / 2 : mx, my < 0 ? 80 : my);
    stream('compress', session.buildCompressRequest(), {
      onChunk: (full) => panel.setChunk(full),
      onDone: (full, usage) => { session.commitCompress(full, usage); panel.done(full); sendResponse({ kind: 'ok' }); },
      onError: (msg) => { panel.error(msg, () => doCompress(sendResponse)); sendResponse({ kind: 'error', message: msg }); },
    });
  }

  // context-menu + popup messages
  chrome.runtime.onMessage.addListener((req: RuntimeRequest, _sender, sendResponse) => {
    if (req.kind === 'contextMenu') {
      if (req.action === 'understand') session.addContext(req.selection);
      else if (req.action === 'translate') selectionTranslate(req.selection);
      return false;
    }
    if (req.kind === 'addContext') { session.addInstruction(req.text); sendResponse({ kind: 'ok' }); return false; }
    if (req.kind === 'clear') { session.reset(); sendResponse({ kind: 'ok' }); return false; }
    if (req.kind === 'getUsage') { sendResponse({ kind: 'usage', usage: session.getUsage() }); return false; }
    if (req.kind === 'compress') { doCompress(sendResponse); return true; } // async response
    return false;
  });
}

void main();