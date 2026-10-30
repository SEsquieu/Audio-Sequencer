import type { SongState } from '../types/song';
import { instrumentRanges } from './instrumentDefaults';
import { defaultFxParams } from '../audio/fx/types';
import type { FxType } from '../audio/fx/types';
import { normalizeSongState } from './songNormalization';

export const PROJECT_FORMAT = 'audio-sequencer-song';
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const fail = (message: string): never => { throw new Error(message); };

/** Validate the musical structure before normalization, playback or persistence. Older optional controls migrate later. */
export function assertSongState(value: unknown): asserts value is SongState {
 if (!object(value)) fail('Project must contain a song object.');
 const s = value as Record<string, unknown>;
 if (!number(s.tempo, 20, 400) || !number(s.swing, 0, .95) || !number(s.bars, 1, 1024) || !Number.isInteger(s.bars)) fail('Invalid tempo, swing or bar count.');
 if (!Array.isArray(s.tracks) || s.tracks.length < 1 || s.tracks.length > 64) fail('A project needs 1–64 tracks.');
 if (s.title !== undefined && (typeof s.title !== 'string' || s.title.length > 120)) fail('Invalid project title.');
 if (s.masterVolume !== undefined && !number(s.masterVolume,0,1)) fail('Invalid master volume.');
 const validateFx = (value: unknown) => {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 32) fail('Invalid effect rack.');
  const fxIds = new Set<string>();
  for (const fx of value as Record<string, unknown>[]) {
   if (!object(fx) || typeof fx.id !== 'string' || fxIds.has(fx.id) || !['saturator','eq3','chorus','djFilter'].includes(String(fx.type)) || !object(fx.params)) fail('Invalid effect instance.');
   fxIds.add(fx.id as string);
   for (const [key, fallback] of Object.entries(defaultFxParams(fx.type as FxType))) {
    const v = (fx.params as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof fallback === 'number' && !number(v,-24000,24000)) fail('Invalid effect control.');
    if (key === 'mode' && v !== 'lp' && v !== 'hp') fail('Invalid filter mode.');
   }
  }
 };
 validateFx(s.masterFx);
 const ids = new Set();
 for (const t of s.tracks as unknown[]) {
  if (!object(t) || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.name !== 'string' || !['synth','drums'].includes(String(t.type))) fail('Invalid or duplicate track.');
  const track = t as Record<string, any>; ids.add(track.id);
  if (!object(track.instrument) || !object(track.patterns) || Object.keys(track.patterns).length > 512 || !Array.isArray(track.lane) || track.lane.length !== s.bars) fail('Invalid instrument, patterns or arrangement length.');
  for (const [key, range] of Object.entries(instrumentRanges)) {
   const v = track.instrument[key];
   if (v !== undefined && !number(v,range[0],range[1])) fail(`Invalid instrument control: ${key}.`);
  }
  for (const key of ['oscWaveformA','oscWaveformB']) if (track.instrument[key] !== undefined && !['sine','triangle','square','sawtooth'].includes(track.instrument[key])) fail('Invalid oscillator waveform.');
  if (track.instrument.advanced !== undefined) {
   const a = track.instrument.advanced;
   if (!object(a)) fail('Invalid advanced synthesis.');
   for (const [key,min,max] of [['tuneA',-24,24],['tuneB',-24,24],['keyTracking',0,1],['lfoRate',.05,30],['lfoDepth',0,1]] as const) if (a[key] !== undefined && !number(a[key],min,max)) fail(`Invalid modulation control: ${key}.`);
   for (const [key, values] of Object.entries({filterMode:['lowpass','highpass','bandpass','notch'],lfoWaveform:['sine','triangle','square','sawtooth'],lfoTarget:['cutoff','pitch','pan','amplitude'],lfoSync:['free','1/1','1/2','1/4','1/8','1/16']})) if (a[key] !== undefined && !values.includes(a[key] as string)) fail(`Invalid modulation option: ${key}.`);
  }
  if (track.mix !== undefined && (!object(track.mix) || !number(track.mix.volume,0,1.5) || !number(track.mix.pan,-1,1))) fail('Invalid channel mix.');
  if (track.send !== undefined) {
   if (!object(track.send)) fail('Invalid sends.');
   for (const key of ['delay','reverb','delayTone','reverbTone','reverbLowCut']) if(track.send[key] !== undefined && !number(track.send[key],0,1)) fail('Invalid send amount.');
  }
  validateFx(track.insertFx);
  for (const id of track.lane) if (typeof id !== 'string' || (id !== '0' && !Object.prototype.hasOwnProperty.call(track.patterns, id))) fail('Arrangement references a missing pattern.');
  for (const p of Object.values(track.patterns) as any[]) {
   if (!object(p) || p.type !== track.type || !Array.isArray(p.steps) || p.steps.length !== 16) fail('Patterns must contain 16 steps and match their track.');
   for (const cell of p.steps as unknown[]) {
    if (p.type === 'synth') {
     // Version-zero songs used a single note object or null rather than a chord array.
     const notes = cell === null ? [] : Array.isArray(cell) ? cell : [cell];
     if (notes.length > 16) fail('Too many notes in a step.');
     for (const n of notes) if (!object(n) || !number(n.pitch,0,127) || !Number.isInteger(n.pitch) || !number(n.length,.0625,64) || !number(n.velocity,0,1) || (n.probability !== undefined && !number(n.probability,0,1)) || (n.ratchet !== undefined && (!number(n.ratchet,1,8) || !Number.isInteger(n.ratchet)))) fail('Invalid note data.');
    } else if (!object(cell) || !['kick','snare','hat'].every(k => number(cell[k],0,1))) fail('Invalid drum velocity.');
   }
  }
 }
 // Reject non-finite controls anywhere; JSON alone does not protect programmatic patches.
 const visit = (v: unknown, depth = 0) => {
  if (depth > 30) fail('Project is too deeply nested.');
  if (typeof v === 'number' && !Number.isFinite(v)) fail('Project contains a non-finite control.');
  if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) {
   if (['__proto__','constructor','prototype'].includes(k)) fail('Project contains an unsafe key.');
   visit(child, depth + 1);
  }
 }; visit(s);
}

export function parseProject(value: unknown): SongState {
 let raw = value;
 if (object(value) && 'format' in value) {
  if (value.format !== PROJECT_FORMAT || value.version !== 1) fail('Unsupported project format or version.');
  raw = value.song;
 }
 assertSongState(raw);
 return normalizeSongState(raw);
}
export const serializeProject = (song: SongState) => {
 assertSongState(song);
 return {format: PROJECT_FORMAT, version: 1 as const, exportedAt: new Date().toISOString(), song};
};
