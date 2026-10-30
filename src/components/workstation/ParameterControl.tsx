import { useId } from 'react';
interface Props { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void; }
export function ParameterControl({label,value,min,max,step=.01,unit='',onChange}: Props) {
 const id=useId();
 return <div className="parameter-control"><label htmlFor={id}>{label}<output>{Number(value.toFixed(2))}{unit}</output></label><input id={id} aria-label={label} type="range" value={value} min={min} max={max} step={step} onChange={e=>onChange(Number(e.target.value))}/></div>;
}
