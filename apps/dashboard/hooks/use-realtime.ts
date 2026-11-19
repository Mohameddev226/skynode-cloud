'use client';

import * as React from 'react';

export interface RealtimeEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown>;
  timestamp: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useRealtime(projectRef: string | null) {
  const [status, setStatus] = React.useState<ConnectionStatus>('disconnected');
  const [events, setEvents] = React.useState<RealtimeEvent[]>([]);
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    if (!projectRef) return;

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const wsUrl = apiBase.replace(/^http/, 'ws') + '/realtime/v1';

    setStatus('connecting');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      // Subscribe to all events for this project
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `project:${projectRef}:*`,
      }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'INSERT' || msg.type === 'UPDATE' || msg.type === 'DELETE') {
          const event: RealtimeEvent = {
            type: msg.type,
            table: msg.table,
            schema: msg.schema ?? 'public',
            record: msg.record ?? {},
            timestamp: msg.timestamp ?? new Date().toISOString(),
          };
          setEvents((prev) => [event, ...prev].slice(0, 50));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('error');

    return () => {
      ws.close();
      wsRef.current = null;
      setStatus('disconnected');
    };
  }, [projectRef]);

  const subscribe = React.useCallback((channel: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const clearEvents = React.useCallback(() => setEvents([]), []);

  return { status, events, subscribe, clearEvents };
}
