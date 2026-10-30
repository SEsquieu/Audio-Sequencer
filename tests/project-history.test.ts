import { describe, expect, it } from 'vitest';
import { createDefaultSong } from '../src/state/defaultSong';
import { parseProject, serializeProject } from '../src/state/project';
import { historyReducer, HistoryState } from '../src/state/history';
import { transformPattern } from '../src/state/patternCommands';
import { INSTRUMENT_PRESETS } from '../src/state/instrumentPresets';
const initial=():HistoryState=>({song:createDefaultSong(),past:[],future:[],error:null});
describe('project boundary',()=>{
 it('round trips all factory patches and optional expressive data',()=>{
  for(const preset of INSTRUMENT_PRESETS){const song=createDefaultSong();const track=song.tracks.find(t=>t.type===preset.type)!;track.instrument=preset.params;expect(parseProject(serializeProject(song)).tracks.find(t=>t.id===track.id)?.instrument).toMatchObject(preset.params);}
  const s=createDefaultSong();s.title='Test';s.tracks[0].mix={volume:.7,pan:-.4};const p=s.tracks[0].patterns['1'];if(p.type==='synth')p.steps[0]=[{pitch:60,velocity:.7,length:2,ratchet:3,probability:.5}];
  expect(parseProject(JSON.parse(JSON.stringify(serializeProject(s))))).toEqual(s);
 });
 it('migrates old mono cells and missing optional controls',()=>{
  const s=createDefaultSong();(s.tracks[0].patterns['1'].steps as any)[0]={pitch:60,length:1,velocity:.8};delete (s.tracks[0].instrument as any).oscWaveformB;
  const result=parseProject(s);expect(result.tracks[0].patterns['1'].steps[0]).toEqual([{pitch:60,length:1,velocity:.8}]);expect(result.tracks[0].instrument.oscWaveformB).toBe('square');
 });
 it.each([
  (s:any)=>s.tempo=0,(s:any)=>s.bars=Infinity,(s:any)=>s.tracks=[],
  (s:any)=>s.tracks[0].lane[0]='missing',(s:any)=>s.tracks[0].patterns['1'].steps=[],
  (s:any)=>s.tracks[0].instrument.cutoff=NaN,(s:any)=>s.tracks[0].instrument.oscWaveformA='invalid',
  (s:any)=>s.tracks[0].mix={volume:1,pan:2},(s:any)=>s.tracks[1].id=s.tracks[0].id,
  (s:any)=>s.tracks[0].patterns['1'].steps[0]=[{pitch:60,length:1,velocity:1,ratchet:20}],
 ])('rejects corrupt projects without mutating the caller',mutate=>{const s=createDefaultSong();mutate(s);const before=structuredClone(s);expect(()=>parseProject(s)).toThrow();expect(s).toEqual(before);});
 it('rejects unknown wrapper versions',()=>{expect(()=>parseProject({...serializeProject(createDefaultSong()),version:99})).toThrow();});
});
describe('history domain',()=>{
 it('groups continuous scalar edits into one undo and retains the original inverse',()=>{
  let s=initial();for(let i=0;i<20;i++)s=historyReducer(s,{type:'commit',at:1000+i*20,patch:{id:String(i),author:'user',label:'Tempo',explanation:'',ops:[{op:'replace',path:'/tempo',value:120+i}]}});
  expect(s.past).toHaveLength(1);s=historyReducer(s,{type:'undo'});expect(s.song.tempo).toBe(120);s=historyReducer(s,{type:'redo'});expect(s.song.tempo).toBe(139);
 });
 it('rejects invalid edits atomically and leaves undo available',()=>{const s=initial();const next=historyReducer(s,{type:'commit',at:0,patch:{id:'x',author:'user',label:'Bad',explanation:'',ops:[{op:'replace',path:'/tempo',value:0}]}});expect(next.song).toBe(s.song);expect(next.error).toContain('rejected');expect(next.past).toHaveLength(0);});
 it('caps undo history at 200 transactions',()=>{let s=initial();for(let i=0;i<250;i++)s=historyReducer(s,{type:'commit',at:i*1000,patch:{id:String(i),author:'user',label:'Tempo',explanation:'',ops:[{op:'replace',path:'/tempo',value:120+i%20}]}});expect(s.past).toHaveLength(200);});
});
describe('non-destructive pattern transforms',()=>{
 it('duplicates data and retains expressive values across transforms',()=>{const p={type:'synth' as const,steps:Array.from({length:16},()=>[] as {pitch:number;velocity:number;length:number;probability:number;ratchet:number}[])};p.steps[0]=[{pitch:60,length:1,velocity:.7,probability:.5,ratchet:2}];const r=transformPattern(p,'reverse');expect(p.steps[0]).toHaveLength(1);if(r.type==='synth')expect(r.steps[15][0]).toEqual(p.steps[0][0]);});
});
