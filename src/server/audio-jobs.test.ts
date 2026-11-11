import { afterEach, expect, it, vi } from 'vitest';
import { Store } from './db';
import { audioRequestSchema, ensureAudio, publicJob } from './audio-jobs';
import { createProject, now } from './projects';
afterEach(() => vi.unstubAllGlobals());
it('rejects unsupported capabilities and missing model without submitting a paid request', async () => {
 const db = new Store(':memory:'); const send = vi.fn(); vi.stubGlobal('fetch', send);
 try {
  const p = createProject(db, 'Draft', {}, true);
  await expect(ensureAudio(db, p.id, {mode:'separate',source_id:'s'})).rejects.toThrow('stem separation is unavailable');
  await expect(ensureAudio(db, p.id, {mode:'music',prompt:'Beat'})).rejects.toThrow('Select an ElevenLabs model');
  expect(send).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM audio_jobs')).toHaveLength(0);
 } finally { db.db.close(); }
});
it('validates generation and analysis limits', () => {
 for (const input of [{mode:'music',prompt:'x',duration_seconds:10.5},{mode:'music',prompt:'x',instrumental:false},{mode:'transcribe',source_id:'s',min_pitch:90,max_pitch:30}]) expect(() => audioRequestSchema.parse(input)).toThrow();
 expect(audioRequestSchema.parse({mode:'music',prompt:'x',duration_seconds:180}).duration_seconds).toBe(180);
});
it('keeps completed stored media accessible without offering remote resubmission', () => {
 expect(publicJob({id:'old-job',project_id:'p',status:'complete',request:JSON.stringify({mode:'music',name:'Audio'}),upstream_id:'paid-request',results:'[]',error:null,created_at:now()}).can_resume).toBe(false);
});
