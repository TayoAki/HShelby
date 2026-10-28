import type { TeamLiveCommand, TeamLiveEvent } from "@hshelby/contracts";
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

/*
 * One WebSocket per tab to /api/live (proxied to the API with the session cookie), shared by every
 * component that listens. It reconnects with backoff; each connection starts with `ready`, which listeners
 * treat like `resync`: catch up once, since events may have been missed while it was down.
 */

const listeners = new Set<(event: TeamLiveEvent) => void>();
const statusListeners = new Set<() => void>();
let socket: WebSocket | null = null;
let connected = false;
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | undefined;

function setConnected(value: boolean) {
  connected = value;
  for (const notify of statusListeners) notify();
}

function open() {
  if (socket || listeners.size === 0) return;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
  socket = ws;
  ws.onmessage = (message) => {
    const event = JSON.parse(String(message.data)) as TeamLiveEvent;
    if (event.type === "ready") {
      attempt = 0;
      setConnected(true);
    }
    for (const listener of listeners) listener(event);
  };
  ws.onclose = (close) => {
    socket = null;
    setConnected(false);
    if (listeners.size === 0) return;
    // 4001: the server wants fresh credentials, so come straight back
    const delay = close.code === 4001 ? 0 : Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
    retry = setTimeout(open, delay);
  };
}

function closeIfUnused() {
  if (listeners.size > 0) return;
  clearTimeout(retry);
  socket?.close();
  socket = null;
}

/** Calls `onEvent` for every live event while the component is mounted. */
export function useLive(onEvent: (event: TeamLiveEvent) => void) {
  const handle = useEffectEvent(onEvent);
  useEffect(() => {
    const listener = (event: TeamLiveEvent) => handle(event);
    listeners.add(listener);
    open();
    return () => {
      listeners.delete(listener);
      // a page change unmounts one listener before the next mounts: don't drop the socket in between
      setTimeout(closeIfUnused, 1000);
    };
  }, []);
}

/** Whether the live socket is connected, so polling can slow down. */
export function useLiveConnected() {
  return useSyncExternalStore(
    (notify) => (statusListeners.add(notify), () => statusListeners.delete(notify)),
    () => connected,
    () => false,
  );
}

export function sendLive(command: TeamLiveCommand) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
}
