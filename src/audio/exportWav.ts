import type { SongState } from '../types/song';
import { assertSongState } from '../state/project';
import { InstrumentEngine, createNoiseBuffer } from './instrumentEngine';
import { MixerGraph } from './mixerGraph';
import { scheduleSongStep } from './scheduler';
import { StepTransport } from './transport';

/** Offline bounce shares the live instrument, mixer, groove and event scheduler. */
export async function renderSongWav(song: SongState): Promise<Blob> {
 assertSongState(song);
 const duration = song.bars * 240 / song.tempo;
 if (duration > 120) throw new Error('WAV export supports arrangements up to two minutes. Export the project file to preserve longer sessions.');
 const sampleRate = 44100;
 const context = new OfflineAudioContext(2, Math.ceil((duration + 3) * sampleRate), sampleRate);
 const audioContext = context as unknown as AudioContext;
 const mixer = new MixerGraph(); mixer.init(audioContext, song.masterVolume ?? .8); mixer.pruneTrackBuses(song);
 const noise = createNoiseBuffer(audioContext);
 const instruments = new InstrumentEngine(()=>audioContext,()=>noise,id=>mixer.getTrackInputNode(audioContext,id));
 const transport = new StepTransport(); transport.setNextStepTime(.03);
 let seed = 0x5eed;
 const random = () => {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for (let i=0;i<song.bars*16;i++) {
  const position=transport.getPosition();
  scheduleSongStep(song,{...position,when:transport.getNextStepTime()},new Set(),instruments,random);
  transport.advance(song);
 }
 const buffer=await context.startRendering();
 instruments.stopAllVoices();
 return encodeWav(buffer);
}
export function encodeWav(buffer:AudioBuffer):Blob {
 const channels=buffer.numberOfChannels, frames=buffer.length;
 const data=new ArrayBuffer(44+frames*channels*2); const view=new DataView(data);
 const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,data.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*channels*2,true);
 const samples=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
 let offset=44;
 for(let frame=0;frame<frames;frame++)for(let channel=0;channel<channels;channel++){
  const sample=Math.max(-1,Math.min(1,samples[channel][frame]));
  view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2;
 }
 return new Blob([data],{type:'audio/wav'});
}
