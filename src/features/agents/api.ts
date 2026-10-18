import { blocksFetch, BlocksError } from '@/lib/blocks-client';
import { BLOCKS } from '@/lib/env';
import { trackedFetch } from '@/lib/tracked-fetch';

/**
 * Blocks AI Agents — list agents, chat with one, browse conversation history, and open a
 * voice session.
 *
 * Chat uses the collaboration flow, the one meant for a signed-in user: a POST that answers
 * with Server-Sent Events. Each `data:` frame is a WebsocketResponse:
 *
 *   { type, response: { conversationId, message: { id, … } },
 *     streamingResponse: { type: LLM_ANSWER | LLM_THINKING | TOOL_CALL_* | END_OF_STREAM …, data, error } }
 *
 * `LLM_ANSWER` chunks carry text deltas. Omitting `conversationId` and passing `agentId`
 * starts a conversation; its id arrives in an early frame.
 *
 * Credentialed CORS only works when the Agents service's allowed-origin regex matches this
 * app's origin — a CORS failure here is configuration, not code.
 */

export const AGENTS_BASE = `${BLOCKS.apiUrl}/agents/v4`;

export interface Agent {
  id?: string;
  agentId?: string;
  agent_id?: string;
  name?: string;
  description?: string;
  agentType?: string;
  agent_type?: string;
  isDisabled?: boolean;
  widgetId?: string;
  widget_id?: string;
  [k: string]: unknown;
}

export const agentId = (a: Agent) => String(a.id ?? a.agentId ?? a.agent_id ?? a.itemId ?? '');

export interface Conversation {
  id?: string;
  conversationId?: string;
  title?: string;
  conversationTitle?: string;
  createdDate?: string;
  updatedDate?: string;
  lastUpdatedDate?: string;
  [k: string]: unknown;
}

export interface ChatMessage {
  id?: string;
  content?: string;
  senderId?: string;
  type?: string;
  createdDate?: string;
  [k: string]: unknown;
}

export interface StreamFrame {
  type?: string;
  response?: { conversationId?: string; message?: { id?: string; content?: string } & Record<string, unknown> } & Record<string, unknown>;
  streamingResponse?: { type?: string; data?: unknown; error?: string | null; reason?: string | null };
  error?: string | null;
  [k: string]: unknown;
}

export interface StreamHandlers {
  onFrame?: (f: StreamFrame) => void;
  onConversation?: (conversationId: string) => void;
  onAnswer?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onError?: (message: string) => void;
}

export const agents = {
  list: (p: { search?: string; limit?: number; offset?: number } = {}) =>
    blocksFetch<{ agents?: Agent[]; total_count?: number; totalCount?: number }>(`${AGENTS_BASE}/agents/queries`, {
      method: 'POST',
      body: { limit: p.limit ?? 100, offset: p.offset ?? 0, ...(p.search ? { search: p.search } : {}) },
    }),
  get: (id: string) => blocksFetch<{ agent?: Agent }>(`${AGENTS_BASE}/agents/query/${encodeURIComponent(id)}`),

  conversations: (page = 1, pageSize = 20) =>
    blocksFetch<{ data?: Conversation[]; totalCount?: number } & Record<string, unknown>>(`${AGENTS_BASE}/collaboration/conversations`, {
      method: 'POST',
      body: { page, pageSize, order: 'desc' },
    }),
  messages: (conversationId: string, page = 1, pageSize = 50) =>
    blocksFetch<{ data?: ChatMessage[] } & Record<string, unknown>>(`${AGENTS_BASE}/collaboration/messages`, {
      method: 'POST',
      body: { conversationId, page, pageSize, order: 'asc' },
    }),
  deleteConversation: (id: string) =>
    blocksFetch<unknown>(`${AGENTS_BASE}/collaboration/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  cancel: (conversationId: string, assistantMessageId?: string) =>
    blocksFetch<unknown>(`${AGENTS_BASE}/collaboration/cancel`, {
      method: 'POST',
      body: { conversationId, ...(assistantMessageId ? { assistantMessageId } : {}) },
    }),

  /** LiveKit room credentials; joining the room needs the livekit-client SDK. */
  voiceSession: (agentIdValue: string, conversationId?: string) =>
    blocksFetch<{ success?: boolean; data?: { url?: string; token?: string; room?: string; conversationId?: string; expiresIn?: number } }>(
      `${AGENTS_BASE}/voice/session`,
      { method: 'POST', body: { agentId: agentIdValue, ...(conversationId ? { conversationId } : {}) } },
    ),
  endVoiceSession: (room: string) => blocksFetch<unknown>(`${AGENTS_BASE}/voice/session/${encodeURIComponent(room)}`, { method: 'DELETE' }),

  widgetConfig: (widgetId: string) =>
    blocksFetch<Record<string, unknown>>(`${AGENTS_BASE}/widget/config?widget_id=${encodeURIComponent(widgetId)}`, { noRetry: true }),

  /**
   * Send one message and stream the reply. Resolves when the stream ends; `signal` aborts
   * it client-side (call `cancel` too to stop the model server-side).
   *
   * This bypasses blocksFetch — it needs the raw body stream — so a 401 here is not
   * renewed automatically. The session is normally fresh from the rest of the app.
   */
  async completion(
    body: { agentId?: string; conversationId?: string; content: string; isTemporary?: boolean },
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await trackedFetch(`${AGENTS_BASE}/collaboration/completion`, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-blocks-key': BLOCKS.projectKey },
      body: JSON.stringify({
        ...(body.conversationId ? { conversationId: body.conversationId } : { agentId: body.agentId }),
        isTemporary: body.isTemporary ?? false,
        isStream: true,
        message: { content: body.content },
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* plain text */
      }
      throw new BlocksError(res.status, res.url, parsed);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        let frame: StreamFrame;
        try {
          frame = JSON.parse(data) as StreamFrame;
        } catch {
          continue;
        }
        dispatch(frame, handlers);
      }
    }
  },
};

function dispatch(frame: StreamFrame, h: StreamHandlers) {
  h.onFrame?.(frame);
  const conv = frame.response?.conversationId;
  if (conv) h.onConversation?.(conv);
  if (frame.type === 'SERVER_ERROR' || frame.error) h.onError?.(String(frame.error ?? 'Server error'));

  const sr = frame.streamingResponse;
  if (!sr) return;
  if (sr.error) h.onError?.(sr.error);
  const text = typeof sr.data === 'string' ? sr.data : '';
  if (!text) return;
  if (sr.type === 'LLM_ANSWER' || sr.type === 'ASSISTANT_STREAMED_RESPONSE') h.onAnswer?.(text);
  else if (sr.type === 'LLM_THINKING') h.onThinking?.(text);
}
