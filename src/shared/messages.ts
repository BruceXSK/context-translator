// Shared type contracts for cross-module messaging.
// Infrastructure only — types, no behavior. Consumed by background / content / popup.
// See design/background.md, design/content.md, design/popup.md.

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

// Token usage reported by the OpenAI-compatible endpoint.
// promptCacheHitTokens / promptCacheMissTokens are DeepSeek-specific and
// present only when the endpoint returns them.
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

// Aggregate usage for the popup display (POP-003): cumulative across all committed
// responses + the most recent translation response (compress responses update the
// cumulative total but do not replace `last`; see SES-005).
export interface UsageSnapshot {
  cumulative: Usage;
  last: Usage | null;
}

// Runtime request messages (chrome.runtime / chrome.tabs messaging).
// translate / compress: content -> background (carries the assembled messages array,
// since the service worker is stateless and the content script owns the session).
// contextMenu: background -> content (right-click "翻译" / "理解").
// addContext / clear / getUsage: popup -> content.
export type RuntimeRequest =
  | { kind: 'translate'; requestId: string; messages: ChatMessage[] }
  | { kind: 'compress'; requestId: string; messages: ChatMessage[] }
  | { kind: 'contextMenu'; action: 'translate' | 'understand'; selection: string }
  | { kind: 'addContext'; text: string }
  | { kind: 'clear' }
  | { kind: 'getUsage' };

export type RuntimeResponse =
  | { kind: 'ok' }
  | { kind: 'usage'; usage: UsageSnapshot }
  | { kind: 'error'; message: string };

// Streaming events pushed over a Port (background -> content), one per token chunk.
export type StreamEvent =
  | { kind: 'chunk'; requestId: string; delta: string }
  | { kind: 'done'; requestId: string; fullText: string; usage: Usage }
  | { kind: 'error'; requestId: string; message: string };