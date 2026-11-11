import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { voiceCatalog } from './profiles'
import { createHash } from 'node:crypto'
it('shows invalid installations as unavailable while empty installations remain usable', () => {
  const root = mkdtempSync(join(tmpdir(), 'vocal-profiles-'))
  try {
    expect(voiceCatalog(root)).toEqual([])
    mkdirSync(join(root, 'broken')); writeFileSync(join(root, 'broken/profile.json'), '{invalid')
    expect(voiceCatalog(root)).toMatchObject([{ id: 'broken', ready: false, reason: expect.stringContaining('invalid') }])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
it('keeps legacy profiles valid without an engine discriminator', () => {
  const root = mkdtempSync(join(tmpdir(), 'vocal-legacy-'))
  try {
    mkdirSync(join(root, 'legacy'))
    writeFileSync(join(root, 'legacy/profile.json'), JSON.stringify({ id: 'legacy', name: 'Legacy', language: 'zh', usage: '',
      reference_revision: 'old', cpu_threads: 2, reference_root: root, experiment: 'exp', vocoder_checkpoint: 'voc', sampling_speedup: 10,
      artifacts: [], capabilities: { manual_pitch: true, manual_phoneme_duration: true, automatic_pitch: false, automatic_phoneme_duration: false } }))
    expect(voiceCatalog(root, process.execPath)).toMatchObject([{ id: 'legacy', languages: ['zh'], ready: true }])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
it('requires native Japanese proof, dictionary, complete components and unchanged hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'vocal-japanese-'))
  try {
    const directory = join(root, 'ja'); mkdirSync(directory)
    mkdirSync(join(directory, 'sifigan/models'), { recursive: true })
    writeFileSync(join(directory, 'sifigan/models/generator.py'), '# fixture')
    const names = ['config.yaml', 'qst.hed', 'kana2phonemes.table',
      ...['acoustic', 'duration', 'timelag', 'vocoder'].flatMap((p) => [`${p}_model.pth`, `${p}_model.yaml`]),
      ...['acoustic', 'duration', 'timelag'].flatMap((p) => [...['min', 'scale'].map((f) => `in_${p}_scaler_${f}.npy`), ...['mean', 'var', 'scale'].map((f) => `out_${p}_scaler_${f}.npy`)]),
      ...['mean', 'var', 'scale'].map((f) => `in_vocoder_scaler_${f}.npy`), 'sys.dic', 'unk.dic', 'matrix.bin', 'char.bin']
    const digest = createHash('sha256').update('fixture').digest('hex')
    names.forEach((n) => writeFileSync(join(directory, n), 'fixture'))
    const report = join(directory, 'validation.json')
    writeFileSync(report, JSON.stringify({ sample_rate: 48000, samples: 48000, peak: .2, rms: .04, packages: { nnsvs: '0.1.1', utaupy: '1.22.1' }, artifacts: names.map((name) => ({ name, sha256: digest })) }))
    const profile = { engine: 'nnsvs', id: 'ja', name: 'Japanese', language: 'ja', usage: '', reference_revision: 'pinned', cpu_threads: 2,
      model_root: directory, reference_root: directory, dictionary_root: directory, validation_report: report, nnsvs_version: '0.1.1',
      artifacts: names.map((name) => ({ path: join(directory, name), sha256: digest })),
      capabilities: { manual_pitch: false, manual_phoneme_duration: true, automatic_pitch: true, automatic_phoneme_duration: true } }
    const save = () => writeFileSync(join(directory, 'profile.json'), JSON.stringify(profile))
    save()
    expect(voiceCatalog(root, process.execPath, process.execPath)).toMatchObject([{ ready: true, languages: ['ja'], controls: { pitch: false } }])
    expect(voiceCatalog(root, process.execPath, join(root, 'absent'))[0]).toMatchObject({ ready: false, reason: expect.stringContaining('environment') })
    writeFileSync(join(directory, 'qst.hed'), 'changed')
    expect(voiceCatalog(root, process.execPath, process.execPath)[0]).toMatchObject({ ready: false, reason: expect.stringContaining('Changed voice file') })
    rmSync(join(directory, 'acoustic_model.pth'))
    expect(voiceCatalog(root, process.execPath, process.execPath)[0]).toMatchObject({ ready: false, reason: expect.stringContaining('Missing voice file') })
    profile.language = 'zh'; save()
    expect(voiceCatalog(root, process.execPath, process.execPath)[0]).toMatchObject({ ready: false, languages: [] })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
