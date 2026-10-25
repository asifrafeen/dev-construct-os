import { create } from 'zustand';

/**
 * State of the live notification connection, plus the events it has delivered — shown on
 * the Notifications page so a push can be seen arriving, not just inferred from the inbox.
 */
export type RealtimeState = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface RealtimeEvent {
  id: number;
  at: string;
  /** The client method the server invoked — the configuration's `NotifyMethod`. */
  method: string;
  args: unknown[];
}

interface RealtimeStatus {
  state: RealtimeState;
  detail: string | null;
  connectionId: string | null;
  events: RealtimeEvent[];
  set: (state: RealtimeState, detail?: string | null) => void;
  setConnectionId: (id: string | null) => void;
  push: (method: string, args: unknown[]) => void;
  clearEvents: () => void;
}

let nextId = 1;

export const useRealtimeStatus = create<RealtimeStatus>()((set) => ({
  state: 'off',
  detail: null,
  connectionId: null,
  events: [],
  set: (state, detail = null) => set({ state, detail }),
  setConnectionId: (connectionId) => set({ connectionId }),
  push: (method, args) =>
    set((s) => ({
      events: [{ id: nextId++, at: new Date().toISOString(), method, args }, ...s.events].slice(0, 50),
    })),
  clearEvents: () => set({ events: [] }),
}));
