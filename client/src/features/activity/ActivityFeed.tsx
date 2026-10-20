import { ChatCircleText, CircleNotch, HandPalm, PaperPlaneTilt, Power, WarningCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityItem } from "../../api/types";
import { clockTime, formatDuration } from "../../components/Elapsed";
import { CategoryIcon } from "./categories";
import "./activity.css";

const VISIBLE = 60;

/** Live log of what Claude did, newest first. Prompts and turn ends read as section markers. */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const { t } = useTranslation("activity");
  const [showAll, setShowAll] = useState(false);
  const newest = [...items].reverse();
  const shown = showAll ? newest : newest.slice(0, VISIBLE);

  return (
    <section className="activity" aria-labelledby="activity-title">
      <header className="activity-head">
        <h3 id="activity-title">{t("title")}</h3>
        <span className="activity-count">{t("count", { count: items.filter((i) => i.kind === "tool").length })}</span>
      </header>
      {items.length === 0 ? (
        <p className="hint activity-empty">{t("empty")}</p>
      ) : (
        <ol className="activity-list">
          <AnimatePresence initial={false}>
            {shown.map((item) => (
              <motion.li
                key={item.id}
                layout="position"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className={`act act-${item.kind}${item.status ? ` is-${item.status}` : ""}`}
              >
                <Row item={item} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {!showAll && newest.length > VISIBLE && (
        <button type="button" className="activity-more" onClick={() => setShowAll(true)}>
          {t("more", { count: newest.length - VISIBLE })}
        </button>
      )}
    </section>
  );
}

function Row({ item }: { item: ActivityItem }) {
  const { t } = useTranslation("activity");
  const time = <time className="act-time">{clockTime(item.at)}</time>;

  if (item.kind === "prompt" || item.kind === "session") {
    const Glyph = item.kind === "prompt" ? PaperPlaneTilt : Power;
    return (
      <div className="act-marker">
        <Glyph weight="bold" aria-hidden="true" />
        <span>{item.summary}</span>
        {time}
      </div>
    );
  }

  if (item.kind === "stop") {
    return (
      <div className="act-stop">
        <ChatCircleText weight="fill" className="act-stop-icon" aria-hidden="true" />
        <div>
          <span className="act-stop-label">{t("stop")}</span>
          <p>
            <InlineCode text={item.summary} />
          </p>
        </div>
        {time}
      </div>
    );
  }

  if (item.kind === "permission") {
    return (
      <div className="act-row">
        <span className="cat-icon cat-attention" aria-hidden="true">
          <HandPalm weight="fill" />
        </span>
        <span className="act-summary">{item.summary}</span>
        {time}
      </div>
    );
  }

  return (
    <details className="act-row" open={false}>
      <summary>
        <CategoryIcon category={item.category} />
        <span className="act-summary">{item.summary}</span>
        <span className="act-meta">
          {item.status === "running" && <CircleNotch className="spin" aria-label={t("running")} />}
          {item.status === "error" && <WarningCircle weight="fill" className="act-error-icon" aria-label={t("error")} />}
          {item.durationMs !== undefined && <span className="act-duration">{formatDuration(item.durationMs)}</span>}
          {time}
        </span>
      </summary>
      {item.detail && <pre className="act-detail">{item.detail}</pre>}
    </details>
  );
}

/** Claude writes `code` in its messages; show it as code instead of raw backticks. */
function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : part,
      )}
    </>
  );
}
