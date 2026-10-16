import { useEffect, useState } from 'react';
import { decimalUnits } from './currency';
import { parseHolding } from './holdings';
/** Invalid pasted text stays visible; the normalized parent value is cleared to block save. */
export function HoldingInput({ label, value, places, disabled, signed=false, onChange }: {label:string;value:string;places:number;disabled?:boolean;signed?:boolean;onChange:(value:string)=>void}) {
  const [raw,setRaw]=useState(value===''?'':decimalUnits(value,places)),[error,setError]=useState('');
  useEffect(()=>{let normalized='';try{normalized=parseHolding(raw,places,signed);}catch{/* preserve invalid original text when parent is empty */}if(normalized!==value){setRaw(value===''?'':decimalUnits(value,places));setError('');}},[value,places]);
  return <span className="holding-input"><input aria-label={label} aria-invalid={!!error} inputMode="decimal" value={raw} disabled={disabled} placeholder="0" onChange={e=>{
    const text=e.target.value;setRaw(text);if(text.trim()===''){setError('');onChange('');return;}
    try{const parsed=parseHolding(text,places,signed);setError('');onChange(parsed);}catch(e){setError(e instanceof Error?e.message:'请检查数字。');onChange('');}
  }}/>{error&&<small role="alert">{error}</small>}</span>;
}
