import { FormRow } from "../ui";
import { flowSteps, progressText } from "./setup-model";
import type { StepStatus } from "./setup-model";
/** Native month picker; the persisted contract stays YYYY-MM. */
export function MonthField({
  label,
  value,
  onChange,
  disabled,
  hint,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
  max?: string;
}) {
  return (
    <FormRow label={label} hint={hint} stacked>
      <input
        className="m-input"
        type="month"
        aria-label={label}
        value={value}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormRow>
  );
}

const statusWord = { done: "已填", attention: "需要确认", todo: "未填" } as const;

/**
 * Where the setup flow is: one tappable dot per step on a line, then the current step's name and position.
 * done = filled ✓, current = outlined, attention = "!" in the warning colour, untouched = grey number.
 */
export function FlowSteps({ index, statuses, onJump, disabled }: { index: number; statuses: StepStatus[]; onJump: (step: number) => void; disabled?: boolean }) {
  return (
    <div className="mp-flow">
      <ol className="mp-flow-dots" aria-label="设置步骤">
        {flowSteps.map((s, i) => {
          const status = statuses[i] ?? "todo";
          return (
            <li key={s.id} className={`mp-flow-dot mp-flow-${status}${i === index ? " mp-flow-current" : ""}${i < index ? " mp-flow-passed" : ""}`}>
              <button
                type="button"
                disabled={disabled}
                aria-current={i === index ? "step" : undefined}
                aria-label={`第 ${i + 1} 步 ${s.title}，${statusWord[status]}`}
                onClick={() => onJump(i)}
              >
                <span aria-hidden="true">{status === "attention" ? "!" : status === "done" ? "✓" : i + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mp-flow-name">
        <strong>{flowSteps[index].title}</strong>
        <span>{progressText(index)}</span>
      </p>
    </div>
  );
}
