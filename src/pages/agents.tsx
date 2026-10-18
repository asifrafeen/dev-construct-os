import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Mic, Send, Square, Trash2, User } from 'lucide-react';
import { agentId, agents, type Agent, type StreamFrame } from '@/features/agents/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Checkbox, Textarea } from '@/components/ui/form';
import { JsonView, PageHeader } from '@/components/ui/layout';
import { cn, formatDate } from '@/lib/utils';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
}

export function AgentsPage() {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

  const select = (a: Agent) => {
    setAgent(a);
    setConversationId(null);
    setTurns([]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI agents"
        description="Chat with the project's Blocks agents as the signed-in user, and browse your conversations."
        endpoints={[
          'POST /agents/v4/agents/queries',
          'POST /agents/v4/collaboration/completion (SSE)',
          'POST /agents/v4/collaboration/conversations',
          'POST /agents/v4/voice/session',
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        <AgentList selected={agent} onSelect={select} />
        <ChatPanel
          agent={agent}
          conversationId={conversationId}
          setConversationId={setConversationId}
          turns={turns}
          setTurns={setTurns}
        />
        <History
          onOpen={(id, loaded) => {
            setConversationId(id);
            setTurns(loaded);
          }}
          activeId={conversationId}
        />
      </div>
    </div>
  );
}

function AgentList({ selected, onSelect }: { selected: Agent | null; onSelect: (a: Agent) => void }) {
  const [search, setSearch] = useState('');
  const list = useQuery({ queryKey: ['agents', 'list', search], queryFn: () => agents.list({ search: search.trim() || undefined }), retry: false });
  const rows = list.data?.agents ?? [];
  return (
    <Card className="h-fit">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Agents</CardTitle>
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </CardHeader>
      <CardContent className="max-h-[60vh] overflow-y-auto">
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : !rows.length ? (
          <EmptyState title="No agents" description="Create one in Blocks OS → Agents." />
        ) : (
          <ul className="space-y-0.5">
            {rows.map((a) => (
              <li key={agentId(a)}>
                <button
                  className={cn('w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent', selected && agentId(selected) === agentId(a) && 'bg-accent font-medium')}
                  onClick={() => onSelect(a)}
                >
                  <span className="flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{a.name ?? agentId(a)}</span>
                    {a.isDisabled && <Badge tone="muted">off</Badge>}
                  </span>
                  {a.description && <span className="line-clamp-2 text-xs text-muted-foreground">{a.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ChatPanel({
  agent,
  conversationId,
  setConversationId,
  turns,
  setTurns,
}: {
  agent: Agent | null;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  turns: Turn[];
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [temporary, setTemporary] = useState(false);
  const [frames, setFrames] = useState<StreamFrame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const voice = useMutation({ mutationFn: () => agents.voiceSession(agentId(agent!), conversationId ?? undefined) });

  const send = async () => {
    const content = input.trim();
    if (!content || (!agent && !conversationId)) return;
    setInput('');
    setError(null);
    setFrames([]);
    setTurns((t) => [...t, { role: 'user', content }, { role: 'assistant', content: '' }]);
    const appendLast = (key: 'content' | 'thinking', delta: string) =>
      setTurns((t) => {
        const copy = [...t];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, [key]: (last[key] ?? '') + delta };
        return copy;
      });

    abort.current = new AbortController();
    setStreaming(true);
    try {
      await agents.completion(
        { agentId: agent ? agentId(agent) : undefined, conversationId: conversationId ?? undefined, content, isTemporary: temporary },
        {
          onFrame: (f) => setFrames((prev) => [...prev, f].slice(-200)),
          onConversation: (id) => setConversationId(id),
          onAnswer: (d) => appendLast('content', d),
          onThinking: (d) => appendLast('thinking', d),
          onError: (m) => setError(m),
        },
        abort.current.signal,
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      void qc.invalidateQueries({ queryKey: ['agents', 'conversations'] });
    }
  };

  const stop = () => {
    abort.current?.abort();
    if (conversationId) void agents.cancel(conversationId).catch(() => undefined);
  };

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{agent?.name ?? (conversationId ? 'Conversation' : 'Pick an agent')}</CardTitle>
          <CardDescription className="truncate">
            {conversationId ? <code className="text-[11px]">{conversationId}</code> : 'A new conversation starts with your first message.'}
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-1">
          {agent && (
            <Button size="sm" variant="outline" disabled={voice.isPending} onClick={() => voice.mutate()} title="Create a LiveKit voice session">
              <Mic className="h-3.5 w-3.5" /> Voice
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConversationId(null);
              setTurns([]);
              setFrames([]);
            }}
          >
            New chat
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {voice.isError && <ErrorNote error={voice.error} />}
        {voice.data && (
          <div className="rounded-md border p-2 text-xs">
            <p className="mb-1 text-muted-foreground">Voice session created — join with the LiveKit client using this url + token:</p>
            <JsonView value={voice.data.data ?? voice.data} maxHeight="max-h-32" />
          </div>
        )}
        <div className="min-h-[18rem] flex-1 space-y-3 overflow-y-auto rounded-md border bg-muted/30 p-3">
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            turns.map((t, i) => (
              <div key={i} className={cn('flex gap-2', t.role === 'user' && 'flex-row-reverse')}>
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  {t.role === 'user' ? <User className="h-3.5 w-3.5 text-primary" /> : <Bot className="h-3.5 w-3.5 text-primary" />}
                </div>
                <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', t.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card')}>
                  {t.thinking && <p className="mb-1 whitespace-pre-wrap text-xs italic text-muted-foreground">{t.thinking}</p>}
                  <p className="whitespace-pre-wrap">{t.content || (streaming && i === turns.length - 1 ? '…' : '')}</p>
                </div>
              </div>
            ))
          )}
        </div>
        {error && <ErrorNote error={error} />}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            rows={2}
            className="min-h-[2.5rem]"
            placeholder={agent || conversationId ? 'Message… (Enter to send, Shift+Enter for a new line)' : 'Pick an agent first'}
            value={input}
            disabled={!agent && !conversationId}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {streaming ? (
            <Button type="button" variant="outline" onClick={stop}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button disabled={!input.trim() || (!agent && !conversationId)}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
        <Checkbox label="Temporary conversation (not saved to history)" checked={temporary} onChange={setTemporary} />
        {frames.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Raw stream frames ({frames.length})</summary>
            <JsonView value={frames} maxHeight="max-h-72" />
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function History({ onOpen, activeId }: { onOpen: (id: string, turns: Turn[]) => void; activeId: string | null }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['agents', 'conversations'], queryFn: () => agents.conversations(), retry: false });
  const open = useMutation({
    mutationFn: async (id: string) => {
      const res = await agents.messages(id);
      const items = (res.data ?? (res as { messages?: unknown[] }).messages ?? []) as { content?: string; senderType?: string; role?: string; type?: string }[];
      return items.map<Turn>((m) => ({
        role: /user|human/i.test(String(m.senderType ?? m.role ?? m.type ?? '')) ? 'user' : 'assistant',
        content: String(m.content ?? ''),
      }));
    },
    onSuccess: (turns, id) => onOpen(id, turns),
  });
  const del = useMutation({ mutationFn: agents.deleteConversation, onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'conversations'] }) });
  const rows = (list.data?.data ?? (list.data as { conversations?: unknown[] } | undefined)?.conversations ?? []) as {
    id?: string;
    conversationId?: string;
    title?: string;
    conversationTitle?: string;
    lastUpdatedDate?: string;
    createdDate?: string;
  }[];

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="text-base">My conversations</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[60vh] overflow-y-auto">
        {[open, del].map((m, i) => m.isError && <ErrorNote key={i} error={m.error} />)}
        {list.isPending ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorNote error={list.error} />
        ) : !rows.length ? (
          <EmptyState title="None yet" />
        ) : (
          <ul className="space-y-0.5">
            {rows.map((c) => {
              const id = String(c.id ?? c.conversationId ?? '');
              return (
                <li key={id} className="flex items-center gap-1">
                  <button
                    className={cn('min-w-0 flex-1 rounded px-2 py-1.5 text-left text-sm hover:bg-accent', activeId === id && 'bg-accent font-medium')}
                    onClick={() => open.mutate(id)}
                  >
                    <span className="block truncate">{c.title ?? c.conversationTitle ?? 'Untitled'}</span>
                    <span className="text-[11px] text-muted-foreground">{formatDate(c.lastUpdatedDate ?? c.createdDate)}</span>
                  </button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => del.mutate(id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
