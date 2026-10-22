import { FormRow } from "../ui";
import { flowSteps } from "./setup-model";
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

/** Where the setup flow is: one segment per step, the current one filled. */
export function FlowProgress({ index }: { index: number }) {
  return (
    <div
      className="mp-flow-progress"
      role="progressbar"
      aria-label="设置进度"
      aria-valuemin={1}
      aria-valuemax={flowSteps.length}
      aria-valuenow={index + 1}
      aria-valuetext={`第 ${index + 1} 步，共 ${flowSteps.length} 步：${flowSteps[index].title}`}
    >
      {flowSteps.map((s, i) => (
        <span key={s.id} className={i <= index ? "mp-flow-done" : undefined} />
      ))}
    </div>
  );
}
