import { describe, expect, it, vi } from 'vitest';
import { BlocksError, UnauthorizedError } from '@/lib/blocks-client';
import { mockFetch } from '@/test/mock-fetch';
import { AGENTS_BASE, agentId, agents, type Agent, type StreamFrame } from './api';

const AG = 'https://blocksapi.example.com/agents/v4';

/** One SSE event per frame, each closed by a blank line. */
const sse = (...frames: unknown[]) => frames.map((f) => `data: ${typeof f === 'string' ? f : JSON.stringify(f)}\n\n`).join('');

function recorder() {
  const frames: StreamFrame[] = [];
  const conversations: string[] = [];
  const answers: string[] = [];
  const thoughts: string[] = [];
  const errors: string[] = [];
  return {
    frames,
    conversations,
    answers,
    thoughts,
    errors,
    handlers: {
      onFrame: (f: StreamFrame) => frames.push(f),
      onConversation: (id: string) => conversations.push(id),
      onAnswer: (delta: string) => answers.push(delta),
      onThinking: (delta: string) => thoughts.push(delta),
      onError: (message: string) => errors.push(message),
    },
  };
}

/** Replaces fetch with one that streams the given byte chunks. */
function streamChunks(chunks: Uint8Array[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));
}

describe('agentId', () => {
  it.each<[string, Agent, string]>([
    ['id first', { id: 'a', agentId: 'b', agent_id: 'c', itemId: 'd' }, 'a'],
    ['then agentId', { agentId: 'b', agent_id: 'c', itemId: 'd' }, 'b'],
    ['then agent_id', { agent_id: 'c', itemId: 'd' }, 'c'],
    ['then itemId', { itemId: 'd' }, 'd'],
    ['and nothing at all', {}, ''],
    ['stringifying a number', { itemId: 7 }, '7'],
  ])('%s', (_case, agent, expected) => {
    expect(agentId(agent)).toBe(expected);
  });
});

describe('agents routes', () => {
  it('is based on the agents service', () => {
    expect(AGENTS_BASE).toBe(AG);
  });

  it('lists the first 100 agents, with a search only when given', async () => {
    const http = mockFetch({ body: { agents: [{ id: 'a1' }], total_count: 1 } });
    await expect(agents.list()).resolves.toEqual({ agents: [{ id: 'a1' }], total_count: 1 });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${AG}/agents/queries` });
    expect(http.last().body).toEqual({ limit: 100, offset: 0 });
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');

    await agents.list({ search: 'support', limit: 10, offset: 20 });
    expect(http.last().body).toEqual({ limit: 10, offset: 20, search: 'support' });

    await agents.list({ search: '' });
    expect(http.last().body).toEqual({ limit: 100, offset: 0 });
  });

  it('reads one agent, encoding the id', async () => {
    const http = mockFetch({ body: { agent: { id: 'a 1' } } });
    await expect(agents.get('a 1')).resolves.toEqual({ agent: { id: 'a 1' } });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${AG}/agents/query/a%201` });
  });

  it('pages conversations newest first', async () => {
    const http = mockFetch({ body: { data: [], totalCount: 0 } });
    await agents.conversations();
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${AG}/collaboration/conversations`,
      body: { page: 1, pageSize: 20, order: 'desc' },
    });

    await agents.conversations(3, 5);
    expect(http.last().body).toEqual({ page: 3, pageSize: 5, order: 'desc' });
  });

  it('pages messages oldest first', async () => {
    const http = mockFetch({ body: { data: [{ id: 'm1', content: 'hi' }] } });
    await expect(agents.messages('c1')).resolves.toEqual({ data: [{ id: 'm1', content: 'hi' }] });
    expect(http.last()).toMatchObject({
      method: 'POST',
      url: `${AG}/collaboration/messages`,
      body: { conversationId: 'c1', page: 1, pageSize: 50, order: 'asc' },
    });

    await agents.messages('c1', 2, 10);
    expect(http.last().body).toEqual({ conversationId: 'c1', page: 2, pageSize: 10, order: 'asc' });
  });

  it('deletes a conversation', async () => {
    const http = mockFetch();
    await agents.deleteConversation('c/1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${AG}/collaboration/conversations/c%2F1`, body: undefined });
  });

  it('cancels a conversation, or one reply in it', async () => {
    const http = mockFetch();
    await agents.cancel('c1');
    expect(http.last()).toMatchObject({ method: 'POST', url: `${AG}/collaboration/cancel` });
    expect(http.last().body).toEqual({ conversationId: 'c1' });

    await agents.cancel('c1', 'm9');
    expect(http.last().body).toEqual({ conversationId: 'c1', assistantMessageId: 'm9' });
  });

  it('opens a voice session, continuing a conversation when given', async () => {
    const session = { success: true, data: { url: 'wss://lk.example', token: 't', room: 'r1' } };
    const http = mockFetch({ body: session });
    await expect(agents.voiceSession('a1')).resolves.toEqual(session);
    expect(http.last()).toMatchObject({ method: 'POST', url: `${AG}/voice/session` });
    expect(http.last().body).toEqual({ agentId: 'a1' });

    await agents.voiceSession('a1', 'c1');
    expect(http.last().body).toEqual({ agentId: 'a1', conversationId: 'c1' });
  });

  it('ends a voice session by room', async () => {
    const http = mockFetch();
    await agents.endVoiceSession('room 1');
    expect(http.last()).toMatchObject({ method: 'DELETE', url: `${AG}/voice/session/room%201` });
  });

  it('reads a widget config without renewing on a 401', async () => {
    const http = mockFetch({ body: { theme: 'dark' } });
    await expect(agents.widgetConfig('w 1')).resolves.toEqual({ theme: 'dark' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${AG}/widget/config?widget_id=w%201` });

    const denied = mockFetch({ status: 401 });
    await expect(agents.widgetConfig('w 1')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(denied.requests).toHaveLength(1);
  });
});

describe('agents.completion request', () => {
  it('starts a conversation with the agent id, streaming, with the session cookie', async () => {
    const http = mockFetch({ body: sse({ type: 'x' }) });
    const signal = new AbortController().signal;
    await expect(agents.completion({ agentId: 'a1', content: 'Hello' }, {}, signal)).resolves.toBeUndefined();

    expect(http.last()).toMatchObject({ method: 'POST', url: `${AG}/collaboration/completion` });
    expect(http.last().body).toEqual({ agentId: 'a1', isTemporary: false, isStream: true, message: { content: 'Hello' } });
    expect(http.last().headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-blocks-key': 'test-project-key',
    });
    expect(http.fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', signal });
  });

  it('continues a conversation by id instead of the agent id', async () => {
    const http = mockFetch({ body: sse({ type: 'x' }) });
    await agents.completion({ agentId: 'a1', conversationId: 'c1', content: 'More', isTemporary: true }, {});
    expect(http.last().body).toEqual({ conversationId: 'c1', isTemporary: true, isStream: true, message: { content: 'More' } });
  });
});

describe('agents.completion stream', () => {
  it('dispatches conversation ids, answers and thinking deltas in order', async () => {
    mockFetch({
      body: sse(
        { type: 'MESSAGE', response: { conversationId: 'c1' } },
        { streamingResponse: { type: 'LLM_THINKING', data: 'Let me see' } },
        { streamingResponse: { type: 'LLM_ANSWER', data: 'Hel' } },
        { streamingResponse: { type: 'ASSISTANT_STREAMED_RESPONSE', data: 'lo' } },
        { streamingResponse: { type: 'TOOL_CALL_START', data: 'search' } },
        { streamingResponse: { type: 'END_OF_STREAM', data: null } },
      ),
    });
    const r = recorder();
    await agents.completion({ agentId: 'a1', content: 'Hi' }, r.handlers);

    expect(r.frames).toHaveLength(6);
    expect(r.conversations).toEqual(['c1']);
    expect(r.thoughts).toEqual(['Let me see']);
    expect(r.answers).toEqual(['Hel', 'lo']);
    expect(r.errors).toEqual([]);
  });

  it('ignores non-string and empty deltas', async () => {
    mockFetch({
      body: sse(
        { streamingResponse: { type: 'LLM_ANSWER', data: { text: 'object' } } },
        { streamingResponse: { type: 'LLM_ANSWER', data: '' } },
        { streamingResponse: { type: 'LLM_ANSWER', data: 'ok' } },
      ),
    });
    const r = recorder();
    await agents.completion({ agentId: 'a1', content: 'Hi' }, r.handlers);
    expect(r.answers).toEqual(['ok']);
  });

  it('reports server errors from the frame and from the streaming response', async () => {
    mockFetch({
      body: sse(
        { type: 'SERVER_ERROR' },
        { error: 'Rate limited' },
        { type: 'SERVER_ERROR', error: 'Model unavailable' },
        { streamingResponse: { type: 'LLM_ANSWER', error: 'Quota exceeded', data: 'partial' } },
      ),
    });
    const r = recorder();
    await agents.completion({ agentId: 'a1', content: 'Hi' }, r.handlers);
    expect(r.errors).toEqual(['Server error', 'Rate limited', 'Model unavailable', 'Quota exceeded']);
    expect(r.answers).toEqual(['partial']);
  });

  it('skips comments, events without data and frames that are not JSON', async () => {
    mockFetch({
      body: `: keep-alive\n\nevent: ping\n\n${sse('not json', { streamingResponse: { type: 'LLM_ANSWER', data: 'ok' } })}`,
    });
    const r = recorder();
    await agents.completion({ agentId: 'a1', content: 'Hi' }, r.handlers);
    expect(r.frames).toHaveLength(1);
    expect(r.answers).toEqual(['ok']);
  });

  it('joins multi-line data fields and accepts CRLF line endings', async () => {
    const event = 'data: {"streamingResponse":\r\ndata:{"type":"LLM_ANSWER","data":"joined"}}\r\n\r\n';
    mockFetch({ body: event });
    const r = recorder();
    await agents.completion({ agentId: 'a1', content: 'Hi' }, r.handlers);
    expect(r.answers).toEqual(['joined']);
  });

  it('does not dispatch an event the stream cut off before its blank line', async () => {
    mockFetch({ body: `${sse({ streamingResponse: { type: 'LLM_ANSWER', data: 'kept' } })}data: {"streamingResponse":{"type":"LLM_ANSWER","data":"lost"}}` });
    const r = recorder();
    await agents.completion({ agentId: 'a1', content: 'Hi' }, r.handlers);
    expect(r.answers).toEqual(['kept']);
  });

  it('reassembles events split across chunks, including a multi-byte character', async () => {
    const bytes = new TextEncoder().encode(sse({ streamingResponse: { type: 'LLM_ANSWER', data: 'héllo' } }));
    const split = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    streamChunks([bytes.slice(0, 5), bytes.slice(5, split), bytes.slice(split)]);
    const r = recorder();
    await agents.completion({ agentId: 'a1', content: 'Hi' }, r.handlers);
    expect(r.answers).toEqual(['héllo']);
  });

  it('works without any handlers', async () => {
    mockFetch({ body: sse({ type: 'SERVER_ERROR', response: { conversationId: 'c1' }, streamingResponse: { type: 'LLM_ANSWER', data: 'x' } }) });
    await expect(agents.completion({ agentId: 'a1', content: 'Hi' }, {})).resolves.toBeUndefined();
  });
});

describe('agents.completion failures', () => {
  it('throws a BlocksError with the parsed JSON body', async () => {
    mockFetch({ status: 403, body: { message: 'Origin not allowed' } });
    const error: unknown = await agents.completion({ agentId: 'a1', content: 'Hi' }, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlocksError);
    expect(error).toMatchObject({ status: 403, body: { message: 'Origin not allowed' } });
  });

  it('keeps a plain-text error body as text', async () => {
    mockFetch({ status: 502, body: 'Bad gateway' });
    await expect(agents.completion({ agentId: 'a1', content: 'Hi' }, {})).rejects.toMatchObject({ status: 502, body: 'Bad gateway' });
  });

  it('treats a reply with no body as a failure', async () => {
    mockFetch({ status: 204 });
    await expect(agents.completion({ agentId: 'a1', content: 'Hi' }, {})).rejects.toMatchObject({ name: 'BlocksError', status: 204 });
  });
});
