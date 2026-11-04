import importlib.util
import unittest

available = importlib.util.find_spec("librosa") is not None


@unittest.skipUnless(available, "install the transcription extra")
class TranscriptionTests(unittest.TestCase):
    def test_monophonic_pitch_silence_and_repeated_attacks(self):
        import numpy as np

        from transcribe import SAMPLE_RATE, analyze

        y = np.zeros(SAMPLE_RATE * 3, dtype=np.float32)
        for pitch, start, end in [(45, 0.2, 0.75), (45, 0.95, 1.5), (50, 1.8, 2.5)]:
            t = np.arange(int((end - start) * SAMPLE_RATE)) / SAMPLE_RATE
            envelope = np.minimum(1, t / 0.02) * np.minimum(1, (end - start - t) / 0.03)
            segment = 0.4 * np.sin(2 * np.pi * 440 * 2 ** ((pitch - 69) / 12) * t) * envelope
            at = round(start * SAMPLE_RATE)
            y[at : at + len(segment)] = segment
        r = analyze(y, low=28, high=64)
        self.assertEqual([n["pitch"] for n in r["notes"]], [45, 45, 50])
        for n, start in zip(r["notes"], (0.2, 0.95, 1.8)):
            self.assertAlmostEqual(n["start"], start, delta=0.08)
        self.assertGreater(r["confidence"], 0.7)
        self.assertEqual(analyze(np.zeros(SAMPLE_RATE))["notes"], [])

    def test_percussion_onsets_and_bounded_pcm(self):
        import numpy as np

        from transcribe import SAMPLE_RATE, analyze

        y = np.zeros(SAMPLE_RATE * 2, dtype=np.float32)
        rng = np.random.default_rng(9)
        for at in (0.25, 0.75, 1.25, 1.75):
            t = np.arange(1600) / SAMPLE_RATE
            burst = rng.normal(size=len(t)) * np.exp(-t * 70) * 0.3
            start = round(at * SAMPLE_RATE)
            y[start : start + len(t)] = burst
        notes = analyze(y, mode="percussion", drum_pitch=38)["notes"]
        self.assertEqual(len(notes), 4)
        self.assertTrue(all(n["pitch"] == 38 for n in notes))
        with self.assertRaises(ValueError):
            analyze(np.zeros(SAMPLE_RATE * 31))
        with self.assertRaises(ValueError):
            analyze(np.array([float("nan")]))
