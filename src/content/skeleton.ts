// DOM skeletonization for hover translations (CT-011).
// Keep translatable inline structure while collapsing opaque inline content into
// atomic placeholders so formulas and code cannot be lost or explode the prompt.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export const MAX_TRANSLATABLE_CHARS = 3000;

const ATOMIC_SELECTOR = [
  'code',
  'kbd',
  'samp',
  'var',
  '.math',
  '.katex',
  '.katex-display',
  'math',
  'mjx-container',
  '.MathJax',
  '.notranslate',
].join(',');

const VERBATIM_SELECTOR = 'code, kbd, samp, var';
const BLOCKED_ATOMIC_SELECTOR = [
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input',
  'button', 'textarea', 'select', 'option', 'frame', 'frameset', 'applet',
].join(',');

export interface SkeletonExtraction {
  skeleton: string;
  originals: Map<number, Element>;
  translatableChars: number;
  truncated: boolean;
}

export interface PlaceholderValidation {
  complete: boolean;
  missingIds: number[];
  duplicateIds: number[];
  unexpectedIds: number[];
  hasInvalidId: boolean;
}

export function isAtomicElement(el: Element): boolean {
  return !el.matches(BLOCKED_ATOMIC_SELECTOR) && el.matches(ATOMIC_SELECTOR);
}

/** Serialize a paragraph into compact inline HTML with one data-ct-id per element. */
export function extractSkeleton(root: Element): SkeletonExtraction {
  const doc = root.ownerDocument;
  if (!doc) throw new Error('Cannot extract a skeleton without an owner document.');

  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('context-translator-block').forEach((node) => node.remove());

  const translatableChars = countTranslatableChars(clone);
  const truncated = translatableChars > MAX_TRANSLATABLE_CHARS;
  if (truncated) trimToBudget(clone, MAX_TRANSLATABLE_CHARS);

  const originals = new Map<number, Element>();
  const counter = { n: 0 };
  const fragment = doc.createDocumentFragment();
  for (const child of Array.from(clone.childNodes)) {
    fragment.appendChild(toSkeleton(child, originals, counter, doc));
  }

  const wrapper = doc.createElement('div');
  wrapper.appendChild(fragment);
  return { skeleton: wrapper.innerHTML, originals, translatableChars, truncated };
}

function countTranslatableChars(node: Node): number {
  let count = 0;
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      for (const ch of child.nodeValue ?? '') {
        if (!/\s/u.test(ch)) count++;
      }
    } else if (child.nodeType === ELEMENT_NODE && !isAtomicElement(child as Element)) {
      count += countTranslatableChars(child);
    }
  }
  return count;
}

interface BudgetCursor {
  remaining: number;
  truncated: boolean;
}

/** Trim at text-node boundaries so the serialized skeleton is always valid HTML. */
function trimToBudget(root: Element, budget: number): void {
  const cursor: BudgetCursor = { remaining: budget, truncated: false };
  trimChildren(root, cursor);
}

function trimChildren(node: Node, cursor: BudgetCursor): void {
  for (const child of Array.from(node.childNodes)) {
    if (cursor.truncated) {
      child.remove();
      continue;
    }
    if (child.nodeType === TEXT_NODE) {
      const current = child.nodeValue ?? '';
      const trimmed = trimText(current, cursor);
      if (trimmed !== current) {
        child.nodeValue = `${trimmed.trimEnd()}...`;
        cursor.truncated = true;
      }
    } else if (child.nodeType === ELEMENT_NODE && !isAtomicElement(child as Element)) {
      trimChildren(child, cursor);
    }
  }
}

function trimText(text: string, cursor: BudgetCursor): string {
  let out = '';
  for (const ch of text) {
    if (!/\s/u.test(ch)) {
      if (cursor.remaining <= 0) return out;
      cursor.remaining--;
    }
    out += ch;
  }
  return out;
}

function toSkeleton(
  node: Node,
  originals: Map<number, Element>,
  counter: { n: number },
  doc: Document,
): Node {
  if (node.nodeType === TEXT_NODE) return doc.createTextNode(node.nodeValue ?? '');
  if (node.nodeType !== ELEMENT_NODE) return doc.createTextNode('');

  const el = node as Element;
  const atomic = isAtomicElement(el);
  const id = ++counter.n;
  originals.set(id, el.cloneNode(atomic) as Element);

  if (atomic) {
    const verbatim = el.matches(VERBATIM_SELECTOR);
    const placeholder = doc.createElement(verbatim ? el.tagName : 'span');
    placeholder.setAttribute('data-ct-id', String(id));
    placeholder.textContent = verbatim ? (el.textContent ?? '') : atomMarker(id);
    return placeholder;
  }

  const placeholder = doc.createElement(el.tagName);
  placeholder.setAttribute('data-ct-id', String(id));
  for (const child of Array.from(el.childNodes)) {
    placeholder.appendChild(toSkeleton(child, originals, counter, doc));
  }
  return placeholder;
}

function atomMarker(id: number): string {
  return `[[CT-ATOM-${id}]]`;
}

/** Check that every original element id appears exactly once in returned HTML. */
export function validatePlaceholderIds(
  root: ParentNode,
  originals: Map<number, Element>,
): PlaceholderValidation {
  const counts = new Map<number, number>();
  let hasInvalidId = false;
  for (const el of Array.from(root.querySelectorAll('[data-ct-id]'))) {
    const raw = el.getAttribute('data-ct-id');
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      hasInvalidId = true;
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const missingIds = [...originals.keys()].filter((id) => !counts.has(id));
  const duplicateIds = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  const unexpectedIds = [...counts.keys()].filter((id) => !originals.has(id));
  return {
    complete: missingIds.length === 0 && duplicateIds.length === 0 && unexpectedIds.length === 0 && !hasInvalidId,
    missingIds,
    duplicateIds,
    unexpectedIds,
    hasInvalidId,
  };
}
