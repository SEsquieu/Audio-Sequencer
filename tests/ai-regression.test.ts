import { it, expect } from 'vitest';
import { aiProposePatch } from '../src/ai/aiProposePatch';
import { createDefaultSong } from '../src/state/defaultSong';
import { applyPatch, invertPatch } from '../src/state/patch';
import { assertSongState } from '../src/state/project';
it.each(['tempo 128','swing 20%','lead delay 40%','add chorus to lead','drums: kick step 2 on','lead: add note c4 step 3 in bar 3'])('preserves local Smart Patch proposal and reversible application: %s',prompt=>{
 const song=createDefaultSong();const before=structuredClone(song);const patches=aiProposePatch(prompt,song,{selectedTrackId:'t-lead',selectedBar:0});expect(patches.length).toBeGreaterThan(0);
 for(const patch of patches){const next=applyPatch(song,patch.ops);expect(()=>assertSongState(next)).not.toThrow();expect(applyPatch(next,invertPatch(song,patch.ops))).toEqual(song);}
 expect(song).toEqual(before);
});
