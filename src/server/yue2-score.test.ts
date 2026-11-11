import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteError, TimeoutError } from 'modal';
import { documentSchema } from '@/shared/schema';
import { planYue2Score, renderYue2Arrangement, yue2ScoreCommands } from './yue2-score';

const modal = vi.hoisted(() => ({
  spawn: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('modal', async importOriginal => {
  const original = await importOriginal<typeof import('modal')>();
  const worker = {
    withOptions: () => worker,
    instance: async () => ({ method: () => ({ spawn: modal.spawn }) }),
  };
  return {
    ...original,
    ModalClient: class {
      cls = { fromName: async () => worker };
    },
  };
});

const input = { name: 'Test', style: 'EDM', lyrics: '[Verse]\nTest', seed: 42 };
const score = {
  bpm: 128, meter: '4/4', duration_beats: 4,
  vocal: [{ start: 0, duration: 1, pitch: 60 }], instrumental: [],
  abc: 'X:1', unit_length: '1/16',
  keys: [{ start: 0, key: 'F#m' }],
  bars: [{ start: 0, duration: 4, meter: '4/4' }],
  chords: [{ start: 0, symbol: 'F#m' }],
  sections: [{ start: 0, duration: 4, name: 'intro' }],
};

it('stores the original ABC and adopts score settings for an empty project', () => {
  const commands = yue2ScoreCommands(score, input, 0, documentSchema.parse({}));
  expect(commands).toContainEqual({ type: 'project.set_tempo', tempo: 128 });
  expect(commands).toContainEqual({ type: 'project.set_key', key: 'F#m' });
  expect(commands[0]).toMatchObject({
    type: 'project.add_abc_score',
    imported: { start_beat: 0, lyrics: input.lyrics, score: { abc: score.abc, chords: score.chords } },
  });
  expect(commands.find(command => command.type === 'project.set_sections')?.sections)
    .toMatchObject(score.sections);
});

it('retains overlapping project sections while preserving the offset source score', () => {
  const document = documentSchema.parse({ sections: [{ name: 'Existing', start: 8, duration: 8 }] });
  const commands = yue2ScoreCommands(score, input, 8, document);
  expect(commands[0]).toMatchObject({
    type: 'project.add_abc_score', imported: { start_beat: 8, score: { sections: score.sections } },
  });
  expect(commands.some(command => command.type === 'project.set_sections' || command.type === 'project.set_tempo')).toBe(false);
});

it('shares identical measures and keeps an across-bar note in a single Clip', () => {
  const scoreWithRepeats = {
    ...score,
    duration_beats: 20,
    bars: Array.from({ length: 5 }, (_, i) => ({ start: i * 4, duration: 4, meter: '4/4' })),
    vocal: [
      { start: 1, pitch: 60, duration: 1 },
      { start: 5, pitch: 60, duration: 1 },
      { start: 11, pitch: 62, duration: 2 },
    ],
  };
  const [command] = yue2ScoreCommands(scoreWithRepeats, input, 8, documentSchema.parse({}));
  if (command.type !== 'project.add_abc_score' || !command.material) throw Error('Expected imported material');
  const { tracks, sources } = command.material;
  const [first, repeat, tied] = tracks[0].clips;
  expect(tracks[0].clips.map(clip => [clip.start_beat, clip.length_beats]))
    .toEqual([[8, 4], [12, 4], [16, 8]]);
  expect(first.source_id).toBe(repeat.source_id);
  expect(sources).toHaveLength(2);
  expect(sources.find(source => source.id === tied.source_id)?.notes).toMatchObject([{ start: 3, pitch: 62, duration: 2 }]);
});

it('keeps editable render tracks muted and requires the score to come from the same render', async () => {
  const song = {
    abc: score.abc, audio_flac: Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(42)]),
    sample_rate: 48000, audio_seconds: 2, truncated: { abc: false },
  };
  modal.get.mockResolvedValueOnce({ song, score });
  const arrangement = await renderYue2Arrangement('demotif', input, new AbortController().signal);
  const [command] = yue2ScoreCommands(arrangement.score, input, 0, documentSchema.parse({}), true);
  expect(command).toMatchObject({ material: { tracks: [{ muted: true }] } });

  modal.get.mockResolvedValueOnce({ song: { ...song, abc: 'different' }, score });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(renderYue2Arrangement('demotif', input, new AbortController().signal))
      .rejects.toThrow('complete rendered ABC');
  } finally {
    warn.mockRestore();
  }
});

beforeEach(() => {
  modal.spawn.mockReset().mockResolvedValue({
    functionCallId: 'fc-test', get: modal.get, cancel: modal.cancel,
  });
  modal.get.mockReset();
  modal.cancel.mockReset().mockResolvedValue(undefined);
});

it('polls the same call after a wait timeout and a transient transport error', async () => {
  modal.get
    .mockRejectedValueOnce(new TimeoutError('Still pending'))
    .mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { code: 14 }))
    .mockResolvedValueOnce(score);
  await expect(planYue2Score('demotif', input, new AbortController().signal)).resolves.toEqual(score);
  expect(modal.spawn).toHaveBeenCalledTimes(1);
  expect(modal.get).toHaveBeenCalledTimes(3);
  expect(modal.cancel).not.toHaveBeenCalled();
});

it('reports a terminal worker error without polling again', async () => {
  modal.get.mockRejectedValueOnce(new RemoteError('Invalid score'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(planYue2Score('demotif', input, new AbortController().signal)).rejects.toThrow(RemoteError);
    expect(modal.get).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('YuE2 request failed', expect.objectContaining({
      stage: 'read', callId: 'fc-test', error: 'RemoteError',
    }));
  } finally {
    warn.mockRestore();
  }
});

it('cancels the remote call when Producer stops during a poll', async () => {
  const controller = new AbortController();
  modal.get.mockImplementationOnce(async () => {
    controller.abort();
    return score;
  });

  await expect(planYue2Score('demotif', input, controller.signal)).rejects.toThrow('aborted');
  expect(modal.get).toHaveBeenCalledTimes(1);
  expect(modal.cancel).toHaveBeenCalledTimes(1);
});
