import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef, type MutableRefObject } from "react";

/** Colors come from the app's CSS variables, so the editor follows the light/dark theme. */
const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--ink)", backgroundColor: "var(--sunken)", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.75" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--signal)" },
  ".cm-gutters": { backgroundColor: "var(--sunken)", color: "var(--faint)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--signal)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--signal-soft) !important" },
});

const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--signal-text)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.monospace, tags.processingInstruction], color: "var(--cat-run)" },
  { tag: [tags.link, tags.url], color: "var(--cat-search)" },
  { tag: tags.list, color: "var(--muted)" },
  { tag: tags.quote, color: "var(--muted)" },
]);

/** `insertRef` receives a function that types text at the cursor (e.g. a template variable). */
export function MarkdownEditor(props: { value: string; onChange: (value: string) => void; label: string; insertRef?: MutableRefObject<((text: string) => void) | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          markdown(),
          theme,
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": props.label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current.focus();
    if (props.insertRef) {
      props.insertRef.current = (text) => {
        const v = view.current;
        if (!v) return;
        v.dispatch(v.state.replaceSelection(text));
        v.focus();
      };
    }
    return () => view.current?.destroy();
    // The editor owns the document after mount; `value` only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="md-editor" ref={host} />;
}
