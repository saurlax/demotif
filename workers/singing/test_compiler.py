import math
import unittest
from score import compile_phrase


class CompilerTests(unittest.TestCase):
    def source(self):
        return {'notes': [{'id': 'a', 'pitch': 60, 'start': 1, 'duration': 1},
                          {'id': 'b', 'pitch': 62, 'start': 2, 'duration': 1}],
                'vocal': {'syllables': {'a': {'kind': 'syllable', 'lyric': '你'}, 'b': {'kind': 'continue'}}}}

    def test_continuation_timing_pitch_and_offset(self):
        ds, meta = compile_phrase(self.source(), 120, {'ni': ['n', 'i']})
        self.assertEqual(ds['ph_seq'], 'SP n i SP')
        self.assertAlmostEqual(sum(map(float, ds['ph_dur'].split())), 1.35)
        self.assertAlmostEqual(meta['offset_seconds'], 0.35)
        f0 = list(map(float, ds['f0_seq'].split()))
        self.assertTrue(all(math.isfinite(x) for x in f0))
        self.assertAlmostEqual(f0[40], 261.625565, places=4)
        self.assertAlmostEqual(f0[150], 293.664768, places=4)

    def test_rests_remain_silent_and_unknown_pronunciation_fails(self):
        source = self.source()
        source['notes'][1]['start'] = 4
        source['vocal']['syllables']['b'] = {'kind': 'syllable', 'lyric': 'ni'}
        ds, _ = compile_phrase(source, 120, {'ni': ['n', 'i']})
        self.assertEqual(ds['ph_seq'], 'SP n i SP n i SP')
        self.assertEqual(float(ds['f0_seq'].split()[200]), 0)
        source['vocal']['syllables']['b']['lyric'] = 'unknown-syllable'
        with self.assertRaisesRegex(ValueError, 'Unknown syllable'):
            compile_phrase(source, 120, {'ni': ['n', 'i']})

    def test_explicit_timing_and_pitch_vibrato_change_the_actual_control_data(self):
        source = self.source()
        source['vocal']['syllables']['a']['phonemes'] = [{'symbol': 'n', 'duration_beats': 0.1}, {'symbol': 'i'}]
        source['vocal']['pitch'] = [{'beat': 1, 'value': 100}]
        source['vocal']['vibrato'] = {'b': {'rate_hz': 5, 'depth_cents': 25, 'onset': 0}}
        ds, meta = compile_phrase(source, 120, {'ni': ['n', 'i']})
        self.assertAlmostEqual(meta['resolved_syllables'][0]['durations_seconds'][0], 0.05)
        self.assertAlmostEqual(float(ds['f0_seq'].split()[40]), 277.182631, places=4)
        source['vocal']['syllables']['a']['phonemes'][0]['duration_beats'] = 4
        with self.assertRaisesRegex(ValueError, 'timing'):
            compile_phrase(source, 120, {'ni': ['n', 'i']})

    def test_fractional_tempo_and_pitch_do_not_interpolate_across_rest(self):
        source = self.source()
        source['notes'][1]['start'] = 4.25
        source['vocal']['syllables']['b'] = {'kind': 'syllable', 'lyric': 'ni'}
        source['vocal']['pitch'] = [{'beat': 1, 'value': 1200}]
        ds, meta = compile_phrase(source, 132.5, {'ni': ['n', 'i']})
        frequency = list(map(float, ds['f0_seq'].split()))
        second_index = math.ceil((0.15 + 3.3 * 60 / 132.5) / 0.005)
        self.assertAlmostEqual(frequency[second_index], 293.664768, places=4)
        self.assertAlmostEqual(meta['offset_seconds'], 60 / 132.5 - 0.15)
        self.assertAlmostEqual(sum(map(float, ds['ph_dur'].split())), meta['duration_seconds'], places=7)

    def test_polyphonic_context_and_explicit_pinyin_preserve_lyric(self):
        source = self.source()
        source['vocal']['syllables'] = {'a': {'kind': 'syllable', 'lyric': '音'}, 'b': {'kind': 'syllable', 'lyric': '乐'}}
        dictionary = {'yin': ['in'], 'yue': ['ve'], 'le': ['l', 'e']}
        ds, _ = compile_phrase(source, 120, dictionary)
        self.assertEqual(ds['ph_seq'], 'SP in ve SP')
        source['vocal']['syllables']['b']['pronunciation'] = 'le'
        ds, _ = compile_phrase(source, 120, dictionary)
        self.assertEqual(ds['ph_seq'], 'SP in l e SP')
        self.assertIn('乐', ds['text'])
        source['vocal']['syllables']['b']['phonemes'] = [{'symbol': 've'}]
        ds, _ = compile_phrase(source, 120, dictionary)
        self.assertEqual(ds['ph_seq'], 'SP in ve SP')

    def test_multiple_syllables_on_one_note_keep_pitch_and_each_syllable_budget(self):
        source = self.source()
        source['notes'] = [{'id': 'a', 'pitch': 60, 'start': 0, 'duration': 4}]
        source['vocal']['syllables'] = {'a': {'kind': 'syllable', 'lyric': '我的妈啊'}}
        dictionary = {'wo': ['w', 'o'], 'de': ['d', 'e'], 'ma': ['m', 'a'], 'a': ['a']}
        ds, meta = compile_phrase(source, 120, dictionary)
        self.assertEqual(ds['ph_seq'], 'SP w o d e m a a SP')
        group = meta['resolved_syllables'][0]
        self.assertEqual(group['syllables'], ['wo', 'de', 'ma', 'a'])
        self.assertEqual(group['syllable_durations_seconds'], [0.5] * 4)
        self.assertAlmostEqual(sum(group['durations_seconds']), 2)
        frequencies = [float(f) for f in ds['f0_seq'].split() if float(f) > 0]
        self.assertTrue(all(abs(f - 261.625565) < 0.0001 for f in frequencies))
        self.assertAlmostEqual(sum(map(float, ds['ph_dur'].split())), 2.35)

    def test_multiple_syllables_continue_only_the_final_syllable(self):
        source = self.source()
        source['vocal']['syllables']['a'] = {'kind': 'syllable', 'mode': 'multiple', 'lyric': '音乐', 'pronunciation': 'yin le'}
        ds, meta = compile_phrase(source, 120, {'yin': ['in'], 'le': ['l', 'e'], 'yue': ['ve']})
        self.assertEqual(ds['ph_seq'], 'SP in l e SP')
        self.assertEqual(meta['resolved_syllables'][0]['syllable_durations_seconds'], [0.25, 0.75])
        source['vocal']['syllables']['a'].pop('pronunciation')
        ds, _ = compile_phrase(source, 120, {'yin': ['in'], 'le': ['l', 'e'], 'yue': ['ve']})
        self.assertEqual(ds['ph_seq'], 'SP in ve SP')
        source['vocal']['syllables']['a']['pronunciation'] = 'yin'
        with self.assertRaisesRegex(ValueError, '2 pronunciation syllables'):
            compile_phrase(source, 120, {'yin': ['in'], 'yue': ['ve']})


if __name__ == '__main__':
    unittest.main()
