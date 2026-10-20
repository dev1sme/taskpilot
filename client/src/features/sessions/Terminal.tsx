import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import i18n from "../../i18n";
import { sessionsApi } from "./api";

type ServerFrame = { t: "o"; d: string } | { t: "x"; code: number | null };

/**
 * xterm.js bound to a session's PTY over WebSocket. The server replays scrollback after the
 * first resize frame, so remounting (tab switch, page reload) restores the screen.
 */
export function Terminal({ sessionId, onExit }: { sessionId: string; onExit: (code: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const el = ref.current!;
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 13,
      scrollback: 10_000,
      // Matches --terminal in styles/tokens.css; the terminal stays dark in both themes.
      theme: { background: "#0f1114", foreground: "#eceef1", cursor: "#7c8cff" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const ws = new WebSocket(sessionsApi.ptyUrl(sessionId));
    const send = (frame: object) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    };
    const sendSize = () => send({ t: "r", cols: term.cols, rows: term.rows });

    // No auto-focus: opening a tab (also by arrow keys) must not pull focus into the terminal.
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
      if (!sawOutput) term.write(`\x1b[2m${i18n.t("notRunning", { ns: "sessions" })}\x1b[0m\r\n`);
      onExitRef.current(frame.code);
    };
    ws.onclose = (e) => {
      if (e.code !== 1000) term.write(`\r\n\x1b[2m${i18n.t("disconnected", { ns: "sessions", code: e.code })}\x1b[0m\r\n`);
    };

    const input = term.onData((d) => send({ t: "i", d }));
    const resized = term.onResize(sendSize);
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      input.dispose();
      resized.dispose();
      ws.onclose = null;
      ws.close(1000);
      term.dispose();
    };
  }, [sessionId]);

  return <div className="terminal" ref={ref} />;
}
