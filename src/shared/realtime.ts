import {z} from 'zod';
import {audioContextSchema} from './schema';

export const realtimeClientEvent = z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('demotif.context'),version:z.number().int().positive(),context:audioContextSchema.nullable(),model:z.string().optional(),client_id:z.string().min(1).max(100).optional()}),
  z.strictObject({type:z.literal('input_audio_buffer.append'),audio:z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/)}),
  z.strictObject({type:z.literal('demotif.hold'),active:z.boolean()}),
  z.strictObject({type:z.literal('demotif.recording_result'),run_id:z.string().min(1).max(100),request_id:z.string().min(1).max(100)}),
  z.strictObject({type:z.enum(['demotif.start','demotif.interrupt','demotif.finish'])}),
]);
export type RealtimeClientEvent=z.infer<typeof realtimeClientEvent>;
const item=z.looseObject({id:z.string().optional(),type:z.string().optional(),role:z.string().optional(),call_id:z.string().optional(),name:z.string().optional(),arguments:z.string().optional(),content:z.array(z.looseObject({type:z.string(),text:z.string().optional(),transcript:z.string().optional()})).optional()});
export const realtimeProviderEvent=z.looseObject({
  type:z.string(),event_id:z.string().optional(),item_id:z.string().optional(),response_id:z.string().optional(),
  delta:z.string().optional(),transcript:z.string().optional(),text:z.string().optional(),
  call_id:z.string().optional(),name:z.string().optional(),arguments:z.string().optional(),item:item.optional(),
  response:z.looseObject({id:z.string(),status:z.string().optional(),output:z.array(item).optional()}).optional(),
  session:z.looseObject({input_audio_format:z.string().optional(),output_audio_format:z.string().optional()}).optional(),
  error:z.looseObject({code:z.union([z.string(),z.number()]).optional(),message:z.string().optional()}).optional(),
});
export type RealtimeProviderEvent=z.infer<typeof realtimeProviderEvent>;
export const realtimeSampleRate=24000;
