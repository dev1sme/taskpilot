import { useEffect, useState } from "react";
import { sessionsApi } from "./api";
import type { ConversationItem } from "./types";

interface ConversationFrame {
  t: string;
  items?: ConversationItem[];
  item?: ConversationItem;
}

export function useConversation(sessionId: string) {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      socket = new WebSocket(sessionsApi.conversationUrl(sessionId));
      socket.onopen = () => {
        if (!disposed) setConnected(true);
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const frame = JSON.parse(String(event.data)) as ConversationFrame;
          if (frame.t === "items" && frame.items) setItems(frame.items);
          if (frame.t === "item" && frame.item) {
            const item = frame.item;
            setItems((previous) => {
              const exists = previous.some((i) => i.id === item.id);
              return (exists ? previous.map((i) => (i.id === item.id ? item : i)) : [...previous, item]).slice(-1000);
            });
          }
        } catch {
          /* Ignore a malformed frame; reconnect replays the buffer. */
        }
      };
      socket.onclose = (event) => {
        if (disposed) return;
        setConnected(false);
        if (event.code < 4400) timer = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [sessionId]);
  return { items, connected };
}
