import copy
import unittest
from japanese_score import compile_ust, morae, phone_durations, resolve_readings


def score():
    return {'notes': [{'id': 'a', 'start': 0, 'duration': 1, 'pitch': 64},
                      {'id': 'b', 'start': 1.1, 'duration': 1, 'pitch': 66}],
            'vocal': {'syllables': {'a': {'kind': 'syllable', 'lyric': '青'},
                                    'b': {'kind': 'syllable', 'lyric': '空'}}, 'pitch': [], 'vibrato': {}}}


class JapaneseScoreTests(unittest.TestCase):
    def test_cross_note_kanji_requires_readings_at_original_beat(self):
        source = score()
        frontend = lambda text: [{'string': '青空', 'pron': 'アオゾラ'}]
        with self.assertRaisesRegex(ValueError, 'Beat 1.*crosses notes'):
            resolve_readings(source, frontend)
        source['vocal']['syllables']['a']['pronunciation'] = 'あお'
        source['vocal']['syllables']['b']['pronunciation'] = 'ぞら'
        before = copy.deepcopy(source)
        self.assertEqual(resolve_readings(source, frontend), {'a': ['あ', 'お'], 'b': ['ぞ', 'ら']})
        self.assertEqual(source, before)

    def test_context_morphology_and_explicit_override(self):
        source = score()
        source['vocal']['syllables']['b']['lyric'] = 'の'
        def frontend(text):
            self.assertEqual(text, '青の')
            return [{'string': '青', 'pron': 'アオ'}, {'string': 'の', 'pron': 'ノ'}]
        self.assertEqual(resolve_readings(source, frontend), {'a': ['あ', 'お'], 'b': ['の']})
        source['vocal']['syllables']['a']['pronunciation'] = 'not kana'
        with self.assertRaisesRegex(ValueError, 'Beat 1'):
            resolve_readings(source, frontend)

    def test_mora_rests_continuation_geometry_and_budget(self):
        source = score()
        source['vocal']['syllables']['b'] = {'kind': 'continue'}
        before = copy.deepcopy(source)
        table = {'きょ': ['ky', 'o'], 'う': ['u']}
        ust, segments, alignment = compile_ust(source, source, 150, {'a': ['きょ', 'う']}, table)
        self.assertIn('Lyric=u', ust)
        self.assertEqual(len(segments), 6)  # lead, two morae, articulation rest, vowel, tail
        self.assertAlmostEqual(sum(s['seconds'] for s in segments), 1.19)
        self.assertAlmostEqual(alignment['offset_seconds'], -.15)
        self.assertEqual(source, before)
        self.assertEqual(morae('キョウ'), ['きょ', 'う'])
        actual = phone_durations({'seconds': 1, 'phones': [{'duration_beats': .5}, {}]}, [1, 3], .4)
        self.assertAlmostEqual(actual[0], .2)
        self.assertAlmostEqual(actual[1], .8)
        with self.assertRaises(ValueError):
            phone_durations({'seconds': .1, 'phones': [{'duration_beats': 1}]}, [1], .4)

    def test_unsupported_expression_is_rejected(self):
        source = score()
        source['vocal']['pitch'] = [{'beat': 0, 'value': 100}]
        with self.assertRaisesRegex(ValueError, 'automatic pitch'):
            compile_ust(source, source, 150, {}, {})

    def test_long_vowel_can_cross_notes_and_phrase_boundaries(self):
        source = score()
        source['vocal']['syllables']['a']['lyric'] = 'ホ'
        source['vocal']['syllables']['b']['lyric'] = 'ーム'
        readings = {'a': ['ほ'], 'b': ['ー', 'む']}
        phrase = {**source, 'notes': source['notes'][1:]}
        _, segments, _ = compile_ust(phrase, source, 150, readings, {'ほ': ['h', 'o'], 'む': ['m', 'u']})
        self.assertEqual(segments[1]['lyric'], 'o')

    def test_devoicing_mark_is_not_a_lyric_phone(self):
        source = score()
        source['vocal']['syllables']['a']['lyric'] = '好き'
        source['vocal']['syllables']['b']['lyric'] = 'だ'
        self.assertEqual(resolve_readings(source, lambda _: [{'string': '好き', 'pron': 'ス’キ'}, {'string': 'だ', 'pron': 'ダ'}])['a'], ['す', 'き'])


if __name__ == '__main__':
    unittest.main()
