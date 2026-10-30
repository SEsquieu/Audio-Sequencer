import { describe, it, expect } from 'vitest';
import { applyPatch, invertPatch } from '../src/state/patch';
import { createDefaultSong } from '../src/state/defaultSong';
import { StepTransport } from '../src/audio/transport';
import { scheduleSongStep } from '../src/audio/scheduler';
import { normalizeSongState } from '../src/state/songNormalization';

describe('patch transaction history', () => {
 it('does not mutate the source on failure', () => {
  const s = { items: [1] };
  expect(() => applyPatch(s, [{op:'replace',path:'/items/0',value:2},{op:'remove',path:'/items/99'}])).toThrow();
  expect(s.items).toEqual([1]);
 });
 it('undoes append operations', () => {
  const s = {items:[1]}; const ops = [{op:'add' as const,path:'/items/-',value:2}];
  expect(applyPatch(applyPatch(s,ops),invertPatch(s,ops))).toEqual(s);
 });
 it('undoes add over an existing object property', () => {
  const s = {tempo:120}; const ops = [{op:'add' as const,path:'/tempo',value:130}];
  expect(applyPatch(applyPatch(s,ops),invertPatch(s,ops))).toEqual(s);
 });
 it.each(['/__proto__/polluted','/constructor/prototype/polluted','/items/01','/items/-'])('rejects unsafe/noncanonical replace path %s', path => {
  expect(() => applyPatch({items:[1,2]},[{op:'replace',path,value:1}])).toThrow();
 });
});
describe('transport and scheduler baseline', () => {
 it('preserves bar duration under swing and wraps loop', () => {
  const s=createDefaultSong(); s.swing=.6;
  const t=new StepTransport(); t.setLoopRange(2,3); t.setPosition(2,0);
  for(let i=0;i<32;i++) t.advance(s);
  expect(t.getPosition()).toEqual({bar:2,step:0}); expect(t.getNextStepTime()).toBeCloseTo(4);
 });
 it('schedules chords in stable order and respects mute', () => {
  const s=createDefaultSong(); const p=s.tracks[0].patterns['1'];
  if(p.type==='synth') p.steps[0]=[{pitch:60,length:1,velocity:.8},{pitch:72,length:2,velocity:.5}];
  const calls:number[]=[]; const engine={playSynthNote:(_t:unknown,p:number)=>calls.push(p)};
  scheduleSongStep(s,{bar:0,step:0,when:1},new Set(),engine as never);
  expect(calls).toEqual([72,60]); calls.length=0;
  scheduleSongStep(s,{bar:0,step:0,when:1},new Set(['t-lead']),engine as never); expect(calls).toEqual([]);
 });
 it('normalizes legacy instrument defaults without changing notes', () => {
  const s=createDefaultSong(); delete (s.tracks[0].instrument as any).oscWaveformA;
  expect(normalizeSongState(s).tracks[0].instrument.oscWaveformA).toBe('sawtooth');
  expect(normalizeSongState(s).tracks[0].patterns).toEqual(s.tracks[0].patterns);
 });
});

describe('missed-clock recovery',()=>{
 it('skips hours without replaying events or leaving the loop',()=>{
  const s=createDefaultSong();s.swing=.4;const t=new StepTransport();t.setLoopRange(2,3);t.setPosition(2,0);t.setNextStepTime(1);
  const dropped=t.skipPast(s,3601.01);
  expect(dropped).toBeGreaterThan(28000);expect(t.getNextStepTime()).toBeGreaterThanOrEqual(3601.01);
  expect(t.getNextStepTime()).toBeLessThan(3601.2);expect(t.getPosition().bar).toBeGreaterThanOrEqual(2);expect(t.getPosition().bar).toBeLessThanOrEqual(3);
 });
 it('ratchets within the swung step and evaluates chance once per note',()=>{
  const s=createDefaultSong();s.swing=.4;const p=s.tracks[0].patterns['1'];if(p.type!=='synth')throw Error();
  p.steps[0]=[{pitch:60,velocity:.8,length:1,ratchet:4,probability:.5}];
  const events:{when:number;length:number}[]=[];const engine={playSynthNote:(_t:unknown,_p:number,_v:number,length:number,when:number)=>events.push({length,when})};
  scheduleSongStep(s,{bar:0,step:0,when:1},new Set(),engine as never,()=>.9);expect(events).toHaveLength(0);
  scheduleSongStep(s,{bar:0,step:0,when:1},new Set(),engine as never,()=>.1);expect(events).toHaveLength(4);
  expect(events.map(e=>e.when)).toEqual([1,1.025,1.05,1.075]);expect(events.every(e=>e.length<.2)).toBe(true);
 });
});
