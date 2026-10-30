import { useState } from 'react';
import type { InstrumentParams, Track } from '../../types/song';
import { normalizeInstrumentParams } from '../../state/instrumentDefaults';
interface SavedPreset {name:string;type:Track['type'];instrument:InstrumentParams;send:Track['send'];}
const KEY='audio-sequencer:user-presets:v1';
export function PresetLibrary({track,onLoad,onAudition}:{track:Track;onLoad:(instrument:InstrumentParams,send:Track['send'])=>void;onAudition:()=>void}) {
 const [presets,setPresets]=useState<SavedPreset[]>(()=>{try { const p=JSON.parse(localStorage.getItem(KEY)||'[]'); return Array.isArray(p)?p.filter(v=>v&&typeof v.name==='string'&&['synth','drums'].includes(v.type)&&v.instrument&&v.send).slice(0,64):[]; } catch{return [];}});
 const [name,setName]=useState(''); const [error,setError]=useState('');
 const save=()=>{if(!name.trim())return;const next=[...presets.filter(p=>p.name!==name.trim()||p.type!==track.type),{name:name.trim(),type:track.type,instrument:structuredClone(track.instrument),send:structuredClone(track.send)}].slice(-64);try{localStorage.setItem(KEY,JSON.stringify(next));setPresets(next);setName('');setError('');}catch{setError('Could not save preset. Storage may be full.');}};
 return <div className="preset-library"><button onClick={onAudition}>♪ Audition sound</button><details><summary>My patches ({presets.filter(p=>p.type===track.type).length})</summary><div className="patch-save"><input aria-label="Patch name" placeholder="Name this patch" maxLength={48} value={name} onChange={e=>setName(e.target.value)}/><button disabled={!name.trim()} onClick={save}>Save patch</button></div>{presets.filter(p=>p.type===track.type).map(p=><button key={p.name} onClick={()=>onLoad(normalizeInstrumentParams(track.type,p.instrument),p.send)}>{p.name}</button>)}{error&&<p role="alert">{error}</p>}</details></div>;
}
