import type { Pattern } from '../types/song';
export const escapePath = (token:string) => token.replace(/~/g,'~0').replace(/\//g,'~1');
export function nextPatternId(patterns:Record<string,Pattern>):string {
 let n=1; while(Object.prototype.hasOwnProperty.call(patterns,String(n))) n++;
 return String(n);
}
export function transformPattern(pattern:Pattern, action:'reverse'|'rotate'|'up'|'down'|'clear'):Pattern {
 const result=structuredClone(pattern);
 if(action==='reverse') result.steps.reverse();
 if(action==='rotate') result.steps.unshift(result.steps.pop() as never);
 if(action==='clear') result.steps=result.type==='synth'?Array.from({length:16},()=>[]):Array.from({length:16},()=>({kick:0,snare:0,hat:0}));
 if(result.type==='synth' && (action==='up'||action==='down')) result.steps=result.steps.map((cell,step)=>cell.map(n=>({...n,pitch:Math.max(0,Math.min(127,n.pitch+(action==='up'?12:-12))),length:Math.min(n.length,16-step)})));
 // Keep note gates inside the pattern after temporal transforms.
 if(result.type==='synth') result.steps=result.steps.map((cell,step)=>cell.map(n=>({...n,length:Math.min(n.length,16-step)})));
 return result;
}
