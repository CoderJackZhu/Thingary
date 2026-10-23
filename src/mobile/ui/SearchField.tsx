import type { InputHTMLAttributes, Ref } from 'react';
import { Icon } from './Icon';
import { t } from '../../i18n.ts';
type Rest = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'placeholder' | 'aria-label'>;
/**
 * The one search box of the phone UI: rounded grey field, magnifier on the left, a 清除 button once something is typed.
 * `subject` is what is searched ("物品"); the placeholder is 「搜索X」 and the accessible name defaults to the same text.
 * Pass `placeholder` only when the example text must differ (e.g. 「搜索名称、品牌、型号、备注」).
 */
export function SearchField({ value, onChange, subject, placeholder, inputRef, ...rest }: { value: string; onChange: (value: string) => void; subject: string; placeholder?: string; inputRef?: Ref<HTMLInputElement> } & Rest) {
  const text = placeholder ?? t('搜索{subject}', { subject });
  return <div className="m-search"><Icon name="search" size={18}/>
    <input type="search" ref={inputRef} aria-label={t('搜索{subject}', { subject })} placeholder={text} autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search" {...rest} value={value} onChange={event => onChange(event.target.value)}/>
    {value && <button type="button" className="m-search-clear" aria-label={t('清除搜索')} disabled={rest.disabled} onClick={() => onChange('')}><Icon name="close" size={16}/></button>}
  </div>;
}
