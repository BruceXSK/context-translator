// Content script: per-page session owner + hover/selection translation UI.
// See design/content.md (CT-001 .. CT-009). Aesthetic: editorial annotation.
import { loadSettings, type Settings } from '../config';
import { Session } from '../session';
import type { ChatMessage, RuntimeRequest, StreamEvent, Usage } from '../shared/messages';

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
.ct-block{position:relative;margin:8px 0 4px;padding:11px 15px 13px 17px;background:var(--ct-paper);
  border-radius:var(--ct-radius);border:1px solid var(--ct-rule);box-shadow:var(--ct-shadow-block);
  font-size:1.0625rem;line-height:1.65;color:var(--ct-ink);animation:ct-rise .16s ease-out}
.ct-block::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:3px;background:var(--ct-accent);opacity:.85}
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
  private errMsg: HTMLElement;
  private errorEl: HTMLElement;
  private retryBtn: HTMLElement;
  constructor() {
    this.host = document.createElement('chrome-translator-block');
    this.host.style.cssText = 'all:initial;display:block;margin:8px 0 4px;box-sizing:border-box';
    const root = shadowOf(this.host);
    root.innerHTML =
      '<div class="ct-block"><span class="ct-eyebrow">译文</span><p class="ct-text"></p>' +
      '<div class="ct-error" hidden><span class="ct-err-msg"></span><button class="ct-retry">重试</button></div></div>';
    this.textEl = root.querySelector<HTMLElement>('.ct-text')!;
    this.errMsg = root.querySelector<HTMLElement>('.ct-err-msg')!;
    this.errorEl = root.querySelector<HTMLElement>('.ct-error')!;
    this.retryBtn = root.querySelector<HTMLElement>('.ct-retry')!;
  }
  start() { this.textEl.textContent = ''; this.textEl.classList.add('ct-streaming'); this.errorEl.hidden = true; }
  setChunk(full: string) { this.textEl.textContent = full; }
  done(full: string) { this.textEl.textContent = full; this.textEl.classList.remove('ct-streaming'); }
  error(msg: string, onRetry: () => void) {
    this.textEl.classList.remove('ct-streaming');
    this.errMsg.textContent = msg;
    this.errorEl.hidden = false;
    this.retryBtn.onclick = onRetry;
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
    this.host = document.createElement('chrome-translator-panel');
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
  text: string;
}
function findParagraph(el: Element | null): ParaHit | null {
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    const direct = BLOCK_TAGS.has(node.tagName);
    const display = direct ? 'block' : getComputedStyle(node).display;
    if (direct || display === 'block' || display === 'list-item' || display === 'table-cell' || display === 'flow-root') {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) return { el: node, text: text.slice(0, MAX_PARA_CHARS) };
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
  const session = new Session(settings.systemPrompt, settings.targetLang);
  const triggerKey = settings.triggerKey || 'Alt';
  const panel = new PanelView();
  (document.body || document.documentElement).appendChild(panel.host);

  interface ParaState {
    view: BlockView;
    translation: string;
    status: 'loading' | 'shown' | 'hidden';
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
    toggleHover(hit.el, hit.text);
  }

  function toggleHover(el: Element, text: string): void {
    let st = paraState.get(el);
    if (!st) {
      st = { view: new BlockView(), translation: '', status: 'hidden' };
      paraState.set(el, st);
      el.after(st.view.host);
    }
    if (st.status === 'shown') { st.view.host.style.display = 'none'; st.status = 'hidden'; return; }
    if (st.status === 'hidden' && st.translation) { st.view.host.style.display = 'block'; st.status = 'shown'; return; }
    fetchHover(el, text, st);
  }

  function fetchHover(el: Element, text: string, st: ParaState): void {
    st.status = 'loading';
    st.view.host.style.display = 'block';
    st.view.start();
    stream('translate', session.buildTranslateRequest(text), {
      onChunk: (full) => st.view.setChunk(full),
      onDone: (full, usage) => {
        st.translation = full;
        st.view.done(full);
        st.status = 'shown';
        session.commitResponse(full, usage);
      },
      onError: (msg) => {
        st.status = 'shown';
        st.view.error(msg, () => fetchHover(el, text, st));
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