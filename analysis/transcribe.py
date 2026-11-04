"""Bounded local analysis of mono PCM supplied by the analysis service; no paths, URLs or model access."""

from __future__ import annotations

import json
import sys
from itertools import pairwise

SAMPLE_RATE = 16000
MAX_SECONDS = 30
VERSION = "pyin-onsets-v2"


def analyze(samples, mode="pitched", low=28, high=84, drum_pitch=42):
    import librosa
    import numpy as np
    from scipy.ndimage import median_filter

    y = np.asarray(samples, dtype=np.float32)
    if y.ndim != 1 or not 0 < len(y) <= SAMPLE_RATE * MAX_SECONDS or not np.isfinite(y).all():
        raise ValueError("Invalid bounded PCM")
    if mode not in {"pitched", "percussion"} or not 21 <= low < high <= 108 or not 0 <= drum_pitch <= 127:
        raise ValueError("Invalid analysis parameters")
    duration = len(y) / SAMPLE_RATE
    result = {"version": VERSION, "duration": duration, "notes": [], "confidence": 0.0, "coverage": 0.0}
    if duration < 0.07 or np.max(np.abs(y)) < 0.0001:
        return result
    hop = 160
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    onsets = librosa.onset.onset_detect(y=y, sr=SAMPLE_RATE, hop_length=hop, backtrack=True, energy=rms)
    peak = max(float(np.max(rms)), 0.0001)
    if mode == "percussion":
        for frame in onsets:
            start = float(frame * hop / SAMPLE_RATE)
            if start >= duration:
                continue
            amplitude = float(np.max(rms[frame : min(len(rms), frame + 8)]))
            if amplitude < peak * 0.06:
                continue
            result["notes"].append(
                {
                    "pitch": drum_pitch,
                    "start": start,
                    "duration": min(0.065, duration - start),
                    "velocity": float(np.clip((amplitude / peak) ** 0.5, 0.2, 0.95)),
                }
            )
        result["confidence"] = 0.65 if result["notes"] else 0.0
        result["coverage"] = 1.0 if result["notes"] else 0.0
        return result
    f0, voiced, probability = librosa.pyin(
        y,
        sr=SAMPLE_RATE,
        fmin=librosa.midi_to_hz(low),
        fmax=librosa.midi_to_hz(high),
        frame_length=2048,
        hop_length=hop,
        fill_na=np.nan,
    )
    midi = np.full(len(f0), -1, dtype=int)
    active = rms[: len(f0)] >= peak * 0.025
    # pYIN's voiced flag already includes its temporal voicing decision. An
    # extra fixed probability gate chops sustained notes and drops bass attacks.
    # Keep its estimated notes; expose probability/coverage for human review.
    valid = voiced & np.isfinite(f0) & active
    midi[valid] = np.rint(librosa.hz_to_midi(f0[valid])).astype(int)
    midi = median_filter(midi, size=3, mode="nearest")
    # Bridge only tiny gaps between the same note; never invent missing melody.
    for i in range(1, len(midi) - 1):
        if midi[i] < 0 and midi[i - 1] == midi[i + 1] and midi[i - 1] >= 0:
            midi[i] = midi[i - 1]
    boundaries = set(np.flatnonzero(np.r_[True, np.diff(midi) != 0]).tolist())
    # Repeated attacks of the same pitch must remain separate editable notes.
    for frame in onsets:
        if 0 < frame < len(midi) and midi[frame] >= 0:
            before = float(np.median(rms[max(0, frame - 8) : max(1, frame - 2)]))
            after = float(np.max(rms[frame : min(len(rms), frame + 8)]))
            if after > max(before * 1.4, peak * 0.06) and min(abs(frame - b) for b in boundaries) >= 7:
                boundaries.add(int(frame))
    boundaries = sorted(boundaries | {len(midi)})
    confidence = []
    for start_frame, end_frame in pairwise(boundaries):
        pitch = int(midi[start_frame])
        start = max(0.0, start_frame * hop / SAMPLE_RATE - 0.012)
        end = min(duration, end_frame * hop / SAMPLE_RATE - 0.012)
        if pitch < low or pitch > high or end - start < 0.07:
            continue
        amp = float(np.max(rms[start_frame:end_frame]))
        score = float(np.mean(probability[start_frame:end_frame]))
        confidence.append(score)
        result["notes"].append(
            {
                "pitch": pitch,
                "start": start,
                "duration": end - start,
                "velocity": float(np.clip((amp / peak) ** 0.5 * 0.85, 0.2, 0.95)),
            }
        )
    result["confidence"] = float(np.mean(confidence)) if confidence else 0.0
    active_seconds = max(hop / SAMPLE_RATE, float(np.count_nonzero(active)) * hop / SAMPLE_RATE)
    result["coverage"] = min(1.0, sum(n["duration"] for n in result["notes"]) / active_seconds)
    return result


def main():
    if "--probe" in sys.argv:
        import importlib.util

        print(
            json.dumps(
                {"ready": all(importlib.util.find_spec(lib) is not None for lib in ("librosa", "numpy", "scipy"))}
            )
        )
        return
    import numpy as np

    raw = sys.stdin.buffer.read(SAMPLE_RATE * MAX_SECONDS * 4 + 4)
    if len(raw) % 4:
        raise ValueError("Invalid PCM length")
    result = analyze(np.frombuffer(raw, dtype="<f4"), sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
