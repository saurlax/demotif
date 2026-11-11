import {z} from 'zod';
export const recordingTargetSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('new_track'),name:z.string().trim().min(1).max(80)}),
  z.strictObject({kind:z.literal('existing_track'),track_id:z.string().min(1).max(100)}),
]);
export const recordingPlanSchema=z.strictObject({
  segment:z.string().trim().min(1).max(500).describe('The phrase/section the user agreed to hum or sing.'),
  name:z.string().trim().min(1).max(80).describe('Name of the recorded audio Clip.'),
  target:recordingTargetSchema.describe('Explicit destination agreed in conversation: existing audio track or named new track.'),
  start_beat:z.number().finite().nonnegative().describe('Agreed start in project quarter-note beats, zero based.'),
  end_beat:z.number().finite().positive().describe('Agreed exclusive end in project quarter-note beats; must exceed start.'),
  count_in:z.enum(['none','four','bar']),
  accompaniment:z.boolean().describe('False for dry humming or unaccompanied vocals.'),
  after_recording:z.enum(['keep_audio','transcribe_notes']).describe('Use keep_audio by default for humming or singing. Use transcribe_notes only when the user explicitly wants notation/editable notes; humming alone never implies transcription.'),
}).refine(p=>p.end_beat>p.start_beat,{message:'Recording end must be after its start.',path:['end_beat']});
export type RecordingPlan=z.infer<typeof recordingPlanSchema>;
export const transportActionSchema=z.strictObject({action:z.enum(['metronome','play','stop']),enabled:z.boolean().optional(),start_beat:z.number().finite().nonnegative().optional()}).superRefine((v,ctx)=>{
  if(v.action==='metronome'&&v.enabled===undefined)ctx.addIssue({code:'custom',message:'Metronome requires enabled.'});
  if(v.action!=='metronome'&&v.enabled!==undefined)ctx.addIssue({code:'custom',message:'enabled is only valid for metronome.'});
  if(v.action!=='play'&&v.start_beat!==undefined)ctx.addIssue({code:'custom',message:'start_beat requires playback.'});
});
export const savePlanSchema=z.strictObject({save_as:z.boolean(),name:z.string().trim().min(1).max(200).nullable()}).refine(v=>!v.save_as||v.name!==null,{message:'Save as requires a name.',path:['name']});
export const studioActionSchema=z.union([transportActionSchema,z.strictObject({action:z.literal('prepare_recording'),plan:recordingPlanSchema}),z.strictObject({action:z.literal('save'),plan:savePlanSchema}),z.strictObject({action:z.literal('export')})]);
export const studioControlSchema=z.object({request_id:z.string().min(1).max(100),client_id:z.string().min(1).max(100),expected_version:z.number().int().positive(),control:studioActionSchema});
export type StudioAction=z.infer<typeof studioActionSchema>;
export type RecordingControl={requestId:string;runId:string;clientId:string};
export type RecordingStatus='scheduled'|'recording'|'captured'|'placed'|'failed'|'cancelled';
export function recordingIds(id:string){return {source_id:`recording-${id}`,part_id:`recording-part-${id}`,track_id:`recording-track-${id}`,clip_id:`recording-clip-${id}`,receipt_id:`recording-${id}`}}
