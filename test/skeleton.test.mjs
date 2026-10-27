import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import {
  extractSkeleton,
  MAX_TRANSLATABLE_CHARS,
  validatePlaceholderIds,
} from '../src/content/skeleton.ts';

function formula(label) {
  return `<span class="math"><span class="katex"><span class="katex-mathml"><math><semantics><mrow><mtext>${label}</mtext></mrow><annotation>${label}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">${'duplicate-formula-'.repeat(80)}</span></span></span>`;
}

const PYTORCH_PARAGRAPH = `
<p id="p">
  The padding size by which to pad some dimensions of
  <code class="xref py py-attr docutils literal notranslate"><span class="pre">input</span></code>
  are described starting from the last dimension and moving forward.
  ${formula('dimension-count')}
  dimensions of <code class="docutils literal notranslate"><span class="pre">input</span></code> will be padded.
  For example, to pad only the last dimension of the input tensor, then
  <a href="#pad"><code class="xref py py-attr docutils literal notranslate"><span class="pre">pad</span></code></a>
  has the form ${formula('last-1')}; to pad the last 2 dimensions of the input tensor,
  then use ${formula('last-2-a')} ${formula('last-2-b')}; to pad the last 3 dimensions,
  use ${formula('last-3-a')} ${formula('last-3-b')} ${formula('last-3-c')}.
</p>`;

function parsedParagraph(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  return document.querySelector('#p');
}

function parsedSkeleton(skeleton) {
  const { document } = parseHTML(`<html><body><div id="root">${skeleton}</div></body></html>`);
  return document.querySelector('#root');
}

test('keeps PyTorch inline code and full paragraph while collapsing KaTeX DOM', () => {
  const result = extractSkeleton(parsedParagraph(PYTORCH_PARAGRAPH));

  assert.equal(result.truncated, false);
  assert.ok(result.translatableChars < MAX_TRANSLATABLE_CHARS);
  assert.ok(result.skeleton.length < MAX_TRANSLATABLE_CHARS);
  assert.match(result.skeleton, />input</);
  assert.match(result.skeleton, />pad</);
  assert.match(result.skeleton, /last 3 dimensions/);
  assert.doesNotMatch(result.skeleton, /katex-html|duplicate-formula|annotation/);
  assert.equal((result.skeleton.match(/\[\[CT-ATOM-\d+\]\]/g) ?? []).length, 7);

  const validation = validatePlaceholderIds(parsedSkeleton(result.skeleton), result.originals);
  assert.equal(validation.complete, true);
});

test('rejects a response that drops an original data-ct-id', () => {
  const result = extractSkeleton(parsedParagraph(PYTORCH_PARAGRAPH));
  const firstId = result.originals.keys().next().value;
  const damaged = result.skeleton.replace(` data-ct-id="${firstId}"`, '');
  const validation = validatePlaceholderIds(parsedSkeleton(damaged), result.originals);

  assert.equal(validation.complete, false);
  assert.deepEqual(validation.missingIds, [firstId]);
});

test('budgets translatable text at node boundaries instead of slicing HTML', () => {
  const longParagraph = `<p id="p">${'word '.repeat(900)}<span class="math">${'formula-'.repeat(200)}</span>tail-marker</p>`;
  const result = extractSkeleton(parsedParagraph(longParagraph));

  assert.equal(result.truncated, true);
  assert.ok(result.translatableChars > MAX_TRANSLATABLE_CHARS);
  assert.match(result.skeleton, /\.\.\.$/);
  assert.doesNotMatch(result.skeleton, /tail-marker/);

  const validation = validatePlaceholderIds(parsedSkeleton(result.skeleton), result.originals);
  assert.equal(validation.complete, true);
});
