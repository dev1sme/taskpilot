import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useEffectEvent, useRef } from "react";
import i18n from "@/i18n";
import { sessionsApi } from "./queries";

type ServerFrame = { t: "o"; d: string } | { t: "x"; code: number | null };

/** Reads the terminal colors from tokens.css, so the palette has one source; the terminal stays dark in both themes. */
function terminalTheme() {
  const css = getComputedStyle(document.documentElement);
  return { background: css.getPropertyValue("--terminal").trim() || "#0a0f1c", foreground: "#f8fafc", cursor: "#22c55e", selectionBackground: "rgba(34, 197, 94, 0.3)" };
}

/**
 * xterm.js bound to a session's PTY over WebSocket. The server replays scrollback after the first
 * resize frame, so remounting restores the screen. `readOnly` replays only (retired or reserved sessions).
 */
export function Terminal({ sessionId, readOnly = false, onExit }: { sessionId: string; readOnly?: boolean; onExit?: (code: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const exit = useEffectEvent((code: number | null) => onExit?.(code));

  useEffect(() => {
    const el = ref.current!;
    const term = new XTerm({
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      scrollback: 10_000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const ws = new WebSocket(sessionsApi.ptyUrl(sessionId));
    const send = (frame: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(frame));
    const sendSize = () => send({ t: "r", cols: term.cols, rows: term.rows });
    // No auto-focus: opening a tab must not pull keyboard focus into the terminal.
    ws.onopen = sendSize;
    let sawOutput = false;
    ws.onmessage = (e: MessageEvent<string>) => {
      const frame = JSON.parse(e.data) as ServerFrame;
      if (frame.t === "o") {
        sawOutput = true;
        term.write(frame.d);
        return;
      }
      // No scrollback: the session ran under an earlier server process.
      if (!sawOutput) term.write(`\x1b[2m${i18n.t(readOnly ? "historyEmpty" : "notRunning", { ns: "sessions" })}\x1b[0m\r\n`);
      exit(frame.code);
    };
    ws.onclose = (e) => {
      if (e.code !== 1000) term.write(`\r\n\x1b[2m${i18n.t("disconnected", { ns: "sessions", code: e.code })}\x1b[0m\r\n`);
    };
    const input = readOnly ? null : term.onData((d) => send({ t: "i", d }));
    const resized = term.onResize(sendSize);
    const observer = new ResizeObserver(() => el.clientWidth > 0 && el.clientHeight > 0 && fit.fit());
    observer.observe(el);
    return () => {
      observer.disconnect();
      input?.dispose();
      resized.dispose();
      ws.onclose = null;
      ws.close(1000);
      term.dispose();
    };
  }, [sessionId, readOnly]);

  return <div ref={ref} className="size-full bg-terminal p-2" aria-label={readOnly ? i18n.t("history", { ns: "sessions" }) : undefined} />;
}
