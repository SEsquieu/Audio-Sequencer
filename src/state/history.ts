import type { HistoryEntry, PatchMeta, SongState } from '../types/song';
import { applyPatch, invertPatch } from './patch';
import { assertSongState } from './project';
export interface HistoryState {song:SongState;past:HistoryEntry[];future:HistoryEntry[];error:string|null;lastEditAt?:number;}
export type HistoryAction = {type:'commit';patch:PatchMeta;at:number}|{type:'undo'|'redo'}|{type:'load';song:SongState};
const canGroup = (a:PatchMeta,b:PatchMeta) => a.author==='user'&&b.author==='user'&&a.label===b.label&&a.ops.length===1&&b.ops.length===1&&a.ops[0].path===b.ops[0].path&&a.ops[0].op!=='remove'&&b.ops[0].op!=='remove'&&typeof a.ops[0].value!=='object'&&typeof b.ops[0].value!=='object';
/** Pure transactions keep the document valid and previews separate from committed history. */
export function historyReducer(state:HistoryState,action:HistoryAction):HistoryState {
 try {
  if(action.type==='load'){assertSongState(action.song);return {song:action.song,past:[],future:[],error:null};}
  if(action.type==='commit'){
   const song=applyPatch(state.song,action.patch.ops);assertSongState(song);
   const last=state.past[state.past.length-1];
   const group=last&&state.future.length===0&&action.at-(state.lastEditAt??0)<600&&canGroup(last.patch,action.patch);
   const entry={patch:action.patch,inverseOps:group?last.inverseOps:invertPatch(state.song,action.patch.ops)};
   return {song,past:[...(group?state.past.slice(0,-1):state.past).slice(-199),entry],future:[],error:null,lastEditAt:action.at};
  }
  const undo=action.type==='undo';const entry=undo?state.past[state.past.length-1]:state.future[0];
  if(!entry)return state;
  const song=applyPatch(state.song,undo?entry.inverseOps:entry.patch.ops);assertSongState(song);
  return {song,past:undo?state.past.slice(0,-1):[...state.past,entry],future:undo?[entry,...state.future]:state.future.slice(1),error:null};
 } catch(error) {return {...state,error:error instanceof Error?`Edit rejected: ${error.message}`:'Edit rejected. Your project is unchanged.'};}
}
