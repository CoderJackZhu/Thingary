import { FormRow } from "../ui";
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
