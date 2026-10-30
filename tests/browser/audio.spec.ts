import { test, expect } from '@playwright/test';
// DSP tests use native Chromium WebAudio rather than mocked nodes.
test.beforeEach(async({page})=>{await page.goto('/');});
test('offline DSP: filter modes, transposition, modulation, dense voice stealing and tails',async({page},testInfo)=>{
 const result=await page.evaluate(async()=>{
  const {InstrumentEngine,createNoiseBuffer}=await import('/src/audio/instrumentEngine.ts');
  const {createDefaultSong}=await import('/src/state/defaultSong.ts');
  const {DEFAULT_ADVANCED}=await import('/src/state/instrumentDefaults.ts');
  const render=async(mode:string,tune=0,depth=0,dense=false)=>{
   const context=new OfflineAudioContext(2,44100*2,44100);
   const track=createDefaultSong().tracks[0];
   Object.assign(track.instrument,{oscWaveformA:'sine',oscWaveformB:'sine',oscMix:0,subOscMix:0,noiseMix:0,detune:0,vibratoDepth:0,attack:.005,decay:.04,sustain:.8,release:.08,cutoff:2000,gain:.2,drive:0,advanced:{...DEFAULT_ADVANCED,tuneA:tune,filterMode:mode,lfoTarget:'pitch',lfoDepth:depth}});
   const engine=new InstrumentEngine(()=>context,()=>createNoiseBuffer(context),()=>context.destination);
   if(dense)for(let i=0;i<48;i++)engine.playSynthNote(track,48+i%24,.3,2,.02+i*.012,120);
   else engine.playSynthNote(track,69,.8,4,.02,120);
   const started=performance.now();const buffer=await context.startRendering();const samples=buffer.getChannelData(0);
   let peak=0,energy=0,tail=0;for(let i=0;i<samples.length;i++){if(!Number.isFinite(samples[i]))throw Error('non-finite DSP');peak=Math.max(peak,Math.abs(samples[i]));energy+=samples[i]*samples[i];if(i>44100*1.8)tail=Math.max(tail,Math.abs(samples[i]));}
   // Measure the fundamental at the two expected frequencies.
   const magnitude=(hz:number)=>{let re=0,im=0;for(let i=4410;i<13230;i++){const phase=2*Math.PI*hz*i/44100;re+=samples[i]*Math.cos(phase);im+=samples[i]*Math.sin(phase);}return Math.hypot(re,im);};
   return {mode,tune,depth,peak,rms:Math.sqrt(energy/samples.length),tail,hz440:magnitude(440),hz880:magnitude(880),steals:engine.getDiagnostics().synthVoiceSteals,renderMs:performance.now()-started};
  };
  return {modes:await Promise.all(['lowpass','highpass','bandpass','notch'].map(mode=>render(mode))),octave:await render('lowpass',12),modulated:await render('lowpass',0,.4),dense:await render('lowpass',0,0,true)};
 });
 for(const mode of result.modes){expect(mode.rms).toBeGreaterThan(.00001);expect(mode.peak).toBeLessThan(1);expect(mode.tail).toBeLessThan(.001);}
 expect(result.modes[0].hz440).toBeGreaterThan(result.modes[0].hz880*3);
 expect(result.octave.hz880).toBeGreaterThan(result.octave.hz440*3);
 expect(result.modulated.hz440).toBeLessThan(result.modes[0].hz440);
 expect(result.dense.steals).toBeGreaterThan(0);expect(result.dense.tail).toBeLessThan(.001);
 await testInfo.attach('offline-dsp-metrics',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
test('WAV bounce renders synth, drums, inserts, pan and sends into a valid stereo file',async({page},testInfo)=>{
 const result=await page.evaluate(async()=>{
  const {renderSongWav}=await import('/src/audio/exportWav.ts');
  const {createDefaultSong}=await import('/src/state/defaultSong.ts');
  const {createFxInstance}=await import('/src/audio/fx/types.ts');
  const song=createDefaultSong();song.bars=1;for(const track of song.tracks)track.lane=['1'];
  song.tracks[0].patterns['1'].steps[0]=[{pitch:60,length:2,velocity:.8,ratchet:2}];
  song.tracks[0].insertFx=[createFxInstance('chorus','chorus'),createFxInstance('eq3','eq')];
  song.tracks[0].mix={volume:.6,pan:-.5};song.tracks[0].send.delay=.3;song.tracks[0].send.reverb=.2;
  song.tracks[2].patterns['1'].steps[0]={kick:1,snare:0,hat:.7};
  song.tracks[2].patterns['1'].steps[4]={kick:0,snare:.8,hat:.6};
  const start=performance.now();const blob=await renderSongWav(song);const bytes=await blob.arrayBuffer();const view=new DataView(bytes);
  let max=0,energy=0;for(let i=44;i<bytes.byteLength;i+=2){const sample=view.getInt16(i,true)/32768;max=Math.max(max,Math.abs(sample));energy+=sample*sample;}
  return {type:blob.type,bytes:blob.size,riff:new TextDecoder().decode(bytes.slice(0,4)),channels:view.getUint16(22,true),rate:view.getUint32(24,true),max,rms:Math.sqrt(energy/((bytes.byteLength-44)/2)),renderMs:performance.now()-start};
 });
 expect(result.riff).toBe('RIFF');expect(result.channels).toBe(2);expect(result.rate).toBe(44100);expect(result.rms).toBeGreaterThan(.001);expect(result.max).toBeLessThan(1);expect(result.bytes).toBeGreaterThan(44100*4);
 await testInfo.attach('wav-metrics',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
test('real-time scheduling survives edits, pause/restart and a blocked main thread',async({page},testInfo)=>{
 const diagnostics=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/src/audio/engine.ts');const {createDefaultSong}=await import('/src/state/defaultSong.ts');
  const song=createDefaultSong();song.swing=.3;
  song.tracks[0].patterns['1'].steps=Array.from({length:16},()=>[{pitch:60,length:1,velocity:.2}]);
  const engine=new AudioEngine();engine.setMasterVolume(.1);await engine.play(()=>song);
  await new Promise(resolve=>setTimeout(resolve,150));
  const start=performance.now();while(performance.now()-start<450){};
  song.tracks[0].instrument.cutoff=800;engine.syncSongState(song);
  await new Promise(resolve=>setTimeout(resolve,150));
  const result=engine.getTimingDiagnostics();engine.pause();await engine.play(()=>song);engine.stop();
  return {...result,stopped:!engine.playing};
 });
 expect(diagnostics.skippedSteps).toBeGreaterThan(0);expect(diagnostics.scheduledSteps).toBeLessThan(12);expect(diagnostics.stopped).toBe(true);
 await testInfo.attach('scheduler-metrics',{body:JSON.stringify(diagnostics,null,2),contentType:'application/json'});
});
