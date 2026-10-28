import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

export type CodeFormat = "markdown" | "json" | "jsonc" | "toml" | "yaml" | "text";

/** Editor colors from tokens.css, so both appearances follow the palette. */
const theme = EditorView.theme({
  "&": { backgroundColor: "var(--surface)", color: "var(--ink)", fontSize: "13px", height: "100%" },
  ".cm-content": { fontFamily: "var(--mono)", caretColor: "var(--signal)" },
  ".cm-gutters": { backgroundColor: "var(--sunken)", color: "var(--faint)", border: "none", borderRight: "1px solid var(--line)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--hover) 55%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--signal-soft) !important" },
  ".cm-cursor": { borderLeftColor: "var(--signal)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
});

/** A code editor with the file's syntax. */
export function CodeEditor({
  value,
  onChange,
  format,
  readOnly = false,
  label,
}: {
  value: string;
  onChange?: (value: string) => void;
  format: CodeFormat;
  readOnly?: boolean;
  label: string;
}) {
  const extensions = useMemo(() => {
    const language =
      format === "markdown" ? [markdown()] : format === "json" || format === "jsonc" ? [json()] : format === "toml" ? [StreamLanguage.define(toml)] : format === "yaml" ? [yaml()] : [];
    return [theme, EditorView.lineWrapping, EditorView.contentAttributes.of({ "aria-label": label }), ...language];
  }, [format, label]);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }}
      height="100%"
      className="h-full"
    />
  );
}
