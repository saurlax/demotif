import json
from pathlib import Path
import subprocess
import sys
import unittest
from demo_scores import phrase


class DemoScoreTests(unittest.TestCase):
    def test_phrase_timing_and_silence(self):
        for seconds in [2, 5, 10]:
            score = phrase(seconds)
            lengths = [len(score[k].split()) for k in ['ph_seq', 'note_seq', 'ph_dur', 'note_dur_seq', 'is_slur_seq']]
            self.assertEqual(len(set(lengths)), 1)
            self.assertAlmostEqual(sum(map(float, score['ph_dur'].split())), seconds, places=7)
            self.assertEqual(len(score['f0_seq'].split()), seconds * 200)
            self.assertEqual(score['is_slur_seq'].split().count('1'), 1)
            self.assertGreater(score['f0_seq'].split().count('0.000000'), 0)
            self.assertTrue(all(x > 0 for x in map(float, score['ph_dur'].split())))

    def test_worker_failure_is_structured_and_shutdown_still_works(self):
        request = {'protocol': 1, 'id': 'bad-profile', 'action': 'ready', 'profile': '/nonexistent/demo-profile.json'}
        stop = {'protocol': 1, 'id': 'stop', 'action': 'shutdown'}
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('worker.py'))],
                                input=json.dumps(request)+'\n'+json.dumps(stop)+'\n',
                                text=True, capture_output=True, check=True)
        events = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(events[-2]['event'], 'error')
        self.assertEqual(events[-2]['id'], 'bad-profile')
        self.assertEqual(events[-1]['event'], 'stopped')


if __name__ == '__main__':
    unittest.main()
