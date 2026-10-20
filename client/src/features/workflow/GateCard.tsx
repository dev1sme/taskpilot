import { ArrowsOut, ChatText, Check, Diamond } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { api } from "../../api/client";
import type { RunState, WorkflowStep } from "../../api/types";
import { Button } from "../../components/Button";
import { Markdown } from "../../components/Markdown";

/**
 * The approval gate, front and center: what Claude produced (file preview + its closing message)
 * and the two ways forward.
 */
export function GateCard(props: {
  taskKey: string;
  run: RunState;
  step: WorkflowStep;
  isLast: boolean;
  docVersion: number;
  onOpenDoc: (path: string) => void;
  onChanged: () => void;
}) {
  const { taskKey, step } = props;
  const docQuery = useQuery({
    queryKey: ["doc", taskKey, step.doneFile, props.docVersion],
    queryFn: () => api.file(taskKey, step.doneFile!),
    enabled: !!step.doneFile,
  });
  const doc = docQuery.data?.content ?? null;
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"approve" | "feedback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackId = useId();

  const act = async (name: "approve" | "feedback", action: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await action();
      setError(null);
      if (name === "feedback") setFeedback("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      props.onChanged();
    }
  };

  return (
    <motion.section
      className="gate-card"
      aria-labelledby={`${feedbackId}-title`}
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
    >
      <header className="gate-head">
        <span className="gate-badge" aria-hidden="true">
          <Diamond weight="fill" />
        </span>
        <div>
          <h3 id={`${feedbackId}-title`}>Đến lượt ba duyệt</h3>
          <p>
            Bước <strong>{step.title}</strong> đã xong.
            {props.isLast ? " Duyệt để hoàn tất quy trình." : " Duyệt để Claude sang bước tiếp theo."}
          </p>
        </div>
      </header>

      {props.run.lastMessage && (
        <figure className="gate-claude">
          <figcaption>Claude tóm tắt</figcaption>
          <Markdown source={props.run.lastMessage} />
        </figure>
      )}

      {step.doneFile && (
        <div className="gate-doc">
          <div className="gate-doc-head">
            <code>{step.doneFile}</code>
            <Button icon={ArrowsOut} variant="quiet" onClick={() => props.onOpenDoc(step.doneFile!)}>
              Đọc toàn bộ
            </Button>
          </div>
          <div className="gate-doc-body">{doc !== null ? <Markdown source={doc} /> : <p className="hint">Đang tải…</p>}</div>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="gate-decide">
        <Button
          icon={Check}
          variant="attention"
          size="lg"
          busy={busy === "approve"}
          disabled={busy !== null}
          onClick={() => void act("approve", () => api.approve(taskKey))}
        >
          {props.isLast ? "Duyệt và hoàn tất" : "Duyệt, sang bước tiếp"}
        </Button>
        <form
          className="gate-feedback"
          onSubmit={(e) => {
            e.preventDefault();
            void act("feedback", () => api.feedback(taskKey, feedback));
          }}
        >
          <label htmlFor={feedbackId}>Hoặc góp ý để Claude sửa lại</label>
          <div className="gate-feedback-row">
            <textarea
              id={feedbackId}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ví dụ: thêm test cho trường hợp danh sách rỗng"
              rows={2}
            />
            <Button type="submit" icon={ChatText} busy={busy === "feedback"} disabled={busy !== null || !feedback.trim()}>
              Gửi góp ý
            </Button>
          </div>
        </form>
      </div>
    </motion.section>
  );
}
