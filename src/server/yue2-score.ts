import { setTimeout as delay } from 'node:timers/promises';
import { ModalClient, TimeoutError, type FunctionCall } from 'modal';
import { z } from 'zod';
import {
  abcScoreSchema, clipSchema, commandSchema, sourceSchema, tempoSchema, timeSignature, trackSchema,
  type Command, type Document,
} from '@/shared/schema';
import { config } from './config';

const beat = z.number().nonnegative();
const scoreNote = z.strictObject({
  start: beat,
  pitch: z.number().int().min(0).max(127),
  duration: z.number().positive(),
});
const scoreSchema = abcScoreSchema.safeExtend({
  vocal: z.array(scoreNote).max(10000),
  instrumental: z.array(scoreNote).max(10000),
}).refine(score =>
  score.vocal.length + score.instrumental.length > 0 &&
  [score.vocal, score.instrumental].every(notes => notes.every((note, index) =>
    note.start + note.duration <= score.duration_beats + 1e-6 && (!index || notes[index - 1].start <= note.start),
  )) &&
  score.bars.every((bar, index) => {
    const previous = score.bars[index - 1];
    return bar.start === (previous ? previous.start + previous.duration : 0);
  }) &&
  score.bars.at(-1)!.start + score.bars.at(-1)!.duration === score.duration_beats,
  'YuE2 returned empty or out-of-range musical events.',
);

export const yue2InputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  style: z.string().trim().min(1),
  lyrics: z.string().trim().min(1),
  start_beat: beat.optional(),
  seed: z.number().int().nonnegative().default(42),
});
type ScoreInput = z.infer<typeof yue2InputSchema>;
type Score = z.infer<typeof scoreSchema>;

// gRPC statuses the Modal SDK treats as retryable, plus Node transport errors.
const transientCodes = new Set<unknown>([
  1, 2, 4, 13, 14, // Cancelled, Unknown, DeadlineExceeded, Internal, Unavailable
  'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN',
]);

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

async function readYue2Call(call: FunctionCall, signal: AbortSignal): Promise<unknown> {
  let transportFailures = 0;
  while (!signal.aborted) {
    try {
      return await call.get({ timeoutMs: 5_000 });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TimeoutError) {
        transportFailures = 0;
        continue;
      }
      const transportFailure = transientCodes.has(errorCode(error)) ||
        (error instanceof TypeError && transientCodes.has(errorCode(error.cause)));
      if (!transportFailure || ++transportFailures > 3) throw error;
      await delay(500 * transportFailures, undefined, { signal });
    }
  }
  throw signal.reason;
}

async function invokeYue2<T>(
  app: string, method: 'plan_project_score' | 'render' | 'render_arrangement', input: ScoreInput, schema: z.ZodType<T>, signal: AbortSignal,
) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(600_000)]);
  let call: FunctionCall | undefined;
  let stage = 'submit';
  let abort: () => void = () => {};
  try {
    deadline.throwIfAborted();
    const client = new ModalClient();
    const worker = await client.cls.fromName(app, 'YuE2', { environment: config.yue2.environment });
    const gpu = config.yue2.gpu;
    const instance = await (gpu ? worker.withOptions({ gpu }) : worker).instance();
    deadline.throwIfAborted();
    call = await instance.method(method).spawn([input.style, input.lyrics, input.seed]);
    stage = 'read';
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(deadline.reason);
      deadline.addEventListener('abort', abort, { once: true });
      if (deadline.aborted) abort();
    });
    const result = await Promise.race([readYue2Call(call, deadline), cancelled]);
    deadline.throwIfAborted();
    stage = 'validate';
    return schema.parse(result);
  } catch (error) {
    if (deadline.aborted) {
      void call?.cancel().catch(() => {});
    }
    if (!signal.aborted) {
      console.warn('YuE2 request failed', {
        method,
        stage,
        callId: call?.functionCallId,
        error: error instanceof Error ? error.name : typeof error,
        code: errorCode(error),
        validation: error instanceof z.ZodError ? error.issues.map(({ code, path }) => ({ code, path })) : undefined,
      });
    }
    throw error;
  } finally {
    deadline.removeEventListener('abort', abort);
  }
}

export function planYue2Score(app: string, input: ScoreInput, signal: AbortSignal) {
  return invokeYue2(app, 'plan_project_score', input, scoreSchema, signal);
}

const songSchema = z.strictObject({
  abc: z.string().nullable(),
  audio_flac: z.instanceof(Uint8Array).refine(bytes =>
    bytes.byteLength > 42 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'fLaC',
  ),
  sample_rate: z.number().int().positive(),
  audio_seconds: z.number().positive(),
  truncated: z.record(z.string(), z.boolean()),
});

export function renderYue2Song(app: string, input: ScoreInput, signal: AbortSignal) {
  return invokeYue2(app, 'render', input, songSchema, signal);
}

const renderedArrangementSchema = z.strictObject({
  song: songSchema,
  score: scoreSchema,
}).refine(result => result.song.abc === result.score.abc && !result.song.truncated.abc,
  'YuE2 arrangement must use the complete rendered ABC.');

export function renderYue2Arrangement(app: string, input: ScoreInput, signal: AbortSignal) {
  return invokeYue2(app, 'render_arrangement', input, renderedArrangementSchema, signal);
}

function melodyClips(score: Score, name: string, startBeat: number, muted: boolean) {
  const sources: z.infer<typeof sourceSchema>[] = [];
  const voices = [
    { label: 'Vocal melody', notes: score.vocal, sound: 'lead' },
    { label: 'Instrumental melody', notes: score.instrumental, sound: 'piano' },
  ] as const;
  const tracks = voices.flatMap(({ label, notes, sound }) => {
    if (!notes.length) return [];
    const title = `${name} · ${label}`;
    const clips: z.infer<typeof clipSchema>[] = [];
    const sourceByNotes = new Map<string, z.infer<typeof sourceSchema>>();
    let firstBar = 0;
    let firstNote = 0;
    let nextNote = 0;
    let soundingUntil = 0;
    for (const [index, bar] of score.bars.entries()) {
      const end = bar.start + bar.duration;
      while (nextNote < notes.length && notes[nextNote].start < end) {
        const note = notes[nextNote++];
        soundingUntil = Math.max(soundingUntil, note.start + note.duration);
      }
      if (soundingUntil > end + 1e-6) continue;
      const start = score.bars[firstBar].start;
      if (firstNote < nextNote) {
        const duration = end - start;
        const relativeNotes = notes.slice(firstNote, nextNote).map(note => ({ ...note, start: note.start - start }));
        const signature = JSON.stringify([duration, relativeNotes]);
        let source = sourceByNotes.get(signature);
        if (!source) {
          const barLabel = firstBar === index ? `${index + 1}` : `${firstBar + 1}–${index + 1}`;
          source = sourceSchema.parse({ name: `${label} · ${barLabel}`, kind: 'notes', sound, notes: relativeNotes, duration });
          sourceByNotes.set(signature, source);
          sources.push(source);
        }
        clips.push(clipSchema.parse({
          name: source.name, kind: 'midi', source_id: source.id,
          start_beat: startBeat + start, length_beats: duration,
        }));
      }
      firstBar = index + 1;
      firstNote = nextNote;
    }
    return [trackSchema.parse({ name: title, kind: 'instrument', clips, muted })];
  });
  return { tracks, sources };
}

export function yue2ScoreCommands(
  score: Score, input: ScoreInput, startBeat: number, document: Document, muteMelodies = false,
): Command[] {
  const { vocal, instrumental, ...notation } = score;
  const commands: Command[] = [commandSchema.parse({
    type: 'project.add_abc_score',
    imported: { name: input.name, start_beat: startBeat, lyrics: input.lyrics, score: notation },
    material: melodyClips({ ...notation, vocal, instrumental }, input.name, startBeat, muteMelodies),
  })];
  if (startBeat === 0 && !document.tracks.length && !document.sections.length && !document.abc_imports?.length) {
    if (tempoSchema.safeParse(score.bpm).success)
      commands.push({ type: 'project.set_tempo', tempo: score.bpm });
    if (timeSignature.safeParse(score.meter).success)
      commands.push({ type: 'project.set_time_signature', time_signature: score.meter });
    const key = score.keys.findLast(change => change.start === 0)?.key;
    if (key) commands.push({ type: 'project.set_key', key });
  }
  const sections = score.sections.map(section => ({
    ...section, name: section.name.slice(0, 120), start: startBeat + section.start,
  })).filter(section => !document.sections.some(existing =>
    section.start < existing.start + existing.duration && existing.start < section.start + section.duration,
  ));
  if (sections.length) {
    commands.push(commandSchema.parse({
      type: 'project.set_sections',
      sections: [...document.sections, ...sections].sort((a, b) => a.start - b.start),
    }));
  }
  return commands;
}
