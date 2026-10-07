import { createContext, useContext } from 'react';
export const FormLabelContext = createContext<string | undefined>(undefined);
export function useFormLabel(existing?: string) { const label = useContext(FormLabelContext); return existing ?? label; }
export const FormHintContext = createContext<string | undefined>(undefined);
export function useFormHint(existing?: string) {
  const hint = useContext(FormHintContext);
  return [existing, hint].filter(Boolean).join(' ') || undefined;
}
