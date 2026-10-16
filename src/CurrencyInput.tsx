import { useEffect, useState } from 'react';
import { decimalUnits, parseDecimal } from './currency';
/** Integer-valued input with currency-specific precision, including whole-yen JPY. */
export function CurrencyInput({label,value,onChange,places,disabled,signed=false}:{label:string;value:string;onChange:(v:string)=>void;places:number;disabled?:boolean;signed?:boolean}) {
 const [raw,setRaw]=useState(value===''?'':decimalUnits(value,places));
 useEffect(()=>{let normalized='';try{normalized=parseDecimal(raw,places,signed);}catch{/* empty text */}if(normalized!==value)setRaw(value===''?'':decimalUnits(value,places));},[value,places]);
 return <input aria-label={label} inputMode={places?'decimal':'numeric'} disabled={disabled} value={raw} placeholder={places?'0.'+'0'.repeat(places):'0'} onChange={e=>{
  const next=e.target.value;if(!new RegExp(`^${signed?'-?':''}\\d{0,19}${places?`(\\.\\d{0,${places}})?`:''}$`).test(next))return;
  let parsed='';try{parsed=parseDecimal(next.endsWith('.')?next.slice(0,-1):next,places,signed);}catch{if(next!==''&&next!=='-')return;}
  setRaw(next);onChange(parsed);
 }}/>;
}
