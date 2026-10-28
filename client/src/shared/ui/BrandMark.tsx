import "./brand-mark.css";

/** Three work streams converge into one forward path. */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 8h5l6 8h7M7 16h18M7 24h5l6-8M21 12l4 4-4 4" />
      </svg>
    </span>
  );
}
