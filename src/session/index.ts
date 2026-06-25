// Per-page translation session: message array, pending-context folding,
// compress-to-summary, and cumulative token usage.
// See design/session.md (SES-001 .. SES-005).

import type { ChatMessage, Usage } from '../shared/messages';
import { COMPRESS_PROMPT, langLabel } from '../config';

/** A buffered context item not yet sent to the LLM. */
export interface PendingItem {
  /** 'context' = selected text added via 理解; 'instruction' = user-typed via popup. */
  kind: 'context' | 'instruction';
  text: string;
}

/**
 * Per-page translation session. The content script owns one instance per page load
 * (ARCH-002). The service worker is stateless; the content script assembles the full
 * message array here and sends it (ARCH-003).
 */
export class Session {
  private turns: ChatMessage[] = [];
  private pending: PendingItem[] = [];
  private cumulativeUsage: Usage = { promptTokens: 0, completionTokens: 0 };
  /** The user message of the most recent in-flight request, awaiting commit. */
  private pendingUserContent: string | null = null;

  constructor(
    private readonly systemPrompt: string,
    private readonly targetLang: string,
  ) {}

  /** Reset to a fresh session (clear action / new page). */
  reset(): void {
    this.turns = [];
    this.pending = [];
    this.cumulativeUsage = { promptTokens: 0, completionTokens: 0 };
    this.pendingUserContent = null;
  }

  /** Add 理解-selected background (not translated, used for context). */
  addContext(text: string): void {
    if (text) this.pending.push({ kind: 'context', text });
  }

  /** Add user-typed explanatory instruction (from popup). */
  addInstruction(text: string): void {
    if (text) this.pending.push({ kind: 'instruction', text });
  }

  /** Build the full message array for a translation request (pending folded, not yet committed). */
  buildTranslateRequest(text: string): ChatMessage[] {
    const userContent = this.foldPending(text);
    this.pendingUserContent = userContent;
    return [this.systemMessage(), ...this.turns, { role: 'user', content: userContent }];
  }

  /**
   * Commit a completed translation: append the user turn (pending-folded) and the
   * assistant turn, clear pending, and accumulate usage. Pending clears on successful
   * commit so a failed request can be retried with the same context re-folded.
   */
  commitResponse(assistantText: string, usage: Usage): void {
    if (this.pendingUserContent == null) return;
    this.turns.push({ role: 'user', content: this.pendingUserContent });
    this.turns.push({ role: 'assistant', content: assistantText });
    this.pending = [];
    this.pendingUserContent = null;
    this.accumulateUsage(usage);
  }

  /** Drop the in-flight request without committing (e.g. on error); pending is retained for a retry. */
  abortRequest(): void {
    this.pendingUserContent = null;
  }

  /** Build a compress request: system + history + a user message asking for a summary. Pending is preserved. */
  buildCompressRequest(): ChatMessage[] {
    return [this.systemMessage(), ...this.turns, { role: 'user', content: COMPRESS_PROMPT }];
  }

  /** Commit a compress result: replace committed history with the summary (assistant). Pending is preserved (SES-004). */
  commitCompress(summary: string, usage: Usage): void {
    this.turns = [{ role: 'assistant', content: summary }];
    this.pendingUserContent = null;
    this.accumulateUsage(usage);
  }

  /** Cumulative token usage across all committed responses (for the popup display). */
  getUsage(): Usage {
    return { ...this.cumulativeUsage };
  }

  private systemMessage(): ChatMessage {
    return { role: 'system', content: `${this.systemPrompt}\n\nTarget language: ${langLabel(this.targetLang)}.` };
  }

  /** Fold pending context into the translation user message with the three XML tags (SES-002). */
  private foldPending(text: string): string {
    const contextText = this.pending.filter((p) => p.kind === 'context').map((p) => p.text).join('\n\n');
    const instructionText = this.pending.filter((p) => p.kind === 'instruction').map((p) => p.text).join('\n\n');
    let content = '';
    if (contextText) content += `<context>\n${contextText}\n</context>\n`;
    if (instructionText) content += `<user-instruction>\n${instructionText}\n</user-instruction>\n`;
    content += `<translate>\n${text}\n</translate>`;
    return content;
  }

  private accumulateUsage(u: Usage): void {
    this.cumulativeUsage.promptTokens += u.promptTokens;
    this.cumulativeUsage.completionTokens += u.completionTokens;
    if (u.promptCacheHitTokens != null) {
      this.cumulativeUsage.promptCacheHitTokens = (this.cumulativeUsage.promptCacheHitTokens ?? 0) + u.promptCacheHitTokens;
    }
    if (u.promptCacheMissTokens != null) {
      this.cumulativeUsage.promptCacheMissTokens = (this.cumulativeUsage.promptCacheMissTokens ?? 0) + u.promptCacheMissTokens;
    }
  }
}