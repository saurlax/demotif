"""Measure real installed native inference; no mock or generated-tone fallback."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import resource
import sys
import time
from native import NativeSinger


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('profile', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--device', default='cpu')
    args = parser.parse_args()
    profile = args.profile.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    singer = NativeSinger(profile, args.device)
    load_seconds = time.perf_counter() - started
    results = []
    for seconds in [2, 5, 10]:
        score_path = profile.with_name(f'demo-{seconds}s.ds')
        score = json.loads(score_path.read_text())
        result = singer.render(score, output / f'native-{seconds}s.wav')
        result['requested_seconds'] = seconds
        results.append(result)
        print(json.dumps(result), flush=True)
    import numpy as np
    import soundfile as sf
    first, rate = sf.read(results[0]['path'], dtype='float32')
    repeat_path = output / 'native-2s-repeat.wav'
    singer.render(json.loads(profile.with_name('demo-2s.ds').read_text()), repeat_path)
    repeat, _ = sf.read(repeat_path, dtype='float32')
    deterministic_delta = float(np.max(np.abs(first-repeat))) if first.shape == repeat.shape else None
    # A 30-second sequence exercises phrase assembly, preserving each phrase's silence/tail.
    chunks = []
    for _ in range(3):
        pcm, _ = sf.read(output / 'native-10s.wav', dtype='float32')
        chunks.append(pcm)
    sf.write(output / 'assembled-30s.wav', np.concatenate(chunks), rate, subtype='FLOAT')
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform != 'darwin': rss *= 1024
    report = {'cold_model_load_seconds': load_seconds, 'results': results,
              'peak_rss_bytes': rss, 'repeat_max_absolute_delta': deterministic_delta,
              'profile': json.loads(profile.read_text()), 'assembled_seconds': sum(map(len, chunks))/rate,
              'quality_review': 'listening review pending; numerical checks alone do not establish naturalness'}
    (output / 'benchmark.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
