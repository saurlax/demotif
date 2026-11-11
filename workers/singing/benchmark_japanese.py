"""Validate a complete native Japanese voice with an original, scored kana phrase."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import resource
import sys
import tempfile
import time


def benchmark(model: Path, sifigan: Path, output: Path) -> dict:
    """Keep model loading and measured inference independent of application state."""
    sys.path.insert(0, str(sifigan.resolve()))
    import numpy as np
    import soundfile as sf
    import torch
    import utaupy
    from nnmnkwii.io import hts
    from nnsvs.svs import SPSVS

    output.mkdir(parents=True, exist_ok=True)
    artifacts = []
    for path in sorted(model.iterdir()):
        if path.suffix in {'.pth', '.yaml', '.npy', '.hed', '.table'}:
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            artifacts.append({'name': path.name, 'sha256': digest})
    torch.set_num_threads(2)
    torch.manual_seed(1234)
    np.random.seed(1234)
    started = time.perf_counter()
    # あおのきょうかい, E major, 150 BPM; explicit model intensity 0030.
    notes = [('R', 60, 180), ('あ', 64, 480), ('お', 66, 480), ('の', 68, 480),
             ('きょ', 71, 480), ('う', 73, 480), ('か', 71, 480), ('い', 68, 480), ('R', 60, 240)]
    text = '[#VERSION]\nUST Version1.2\n[#SETTING]\nTempo=150\nTracks=1\n'
    for index, (lyric, pitch, length) in enumerate(notes):
        text += (f'[#{index:04d}]\nLength={length}\nLyric={lyric}\nNoteNum={pitch}\n'
                 'Tempo=150\nIntensity=100\nFlags=0030\n')
    text += '[#TRACKEND]\n'
    with tempfile.TemporaryDirectory() as temporary:
        score, label = Path(temporary) / 'score.ust', Path(temporary) / 'score.lab'
        score.write_text(text, encoding='utf-8')
        ust = utaupy.ust.load(str(score), encoding='utf-8')
        table = utaupy.table.load(str(model / 'kana2phonemes.table'), encoding='utf-8')
        utaupy.utils.ustobj2songobj(ust, table).write(str(label), strict_sinsy_style=False)
        labels = hts.load(str(label))
    engine = SPSVS(model, device='cpu')
    loaded = time.perf_counter()
    with torch.inference_mode():
        pcm, rate = engine.svs(labels, vocoder_type='usfgan', dtype=np.float32)
    elapsed = time.perf_counter() - loaded
    pcm = np.asarray(pcm, dtype=np.float32)
    if pcm.ndim != 1 or not pcm.size or not np.isfinite(pcm).all() or np.max(np.abs(pcm)) < 1e-5:
        raise ValueError('Native Japanese inference did not produce valid audible PCM')
    sf.write(output / 'original-japanese-phrase.wav', pcm, rate, subtype='FLOAT')
    result = {'voice': 'Namine Ritsu CRISSCROSS 2824', 'sample_rate': rate,
              'samples': len(pcm), 'duration_seconds': len(pcm) / rate,
              'peak': float(np.max(np.abs(pcm))), 'rms': float(np.sqrt(np.mean(pcm ** 2))),
              'load_seconds': loaded - started, 'render_seconds': elapsed,
              'peak_rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
              'packages': {name: importlib.metadata.version(name) for name in
                           ['torch', 'torchaudio', 'nnsvs', 'nnmnkwii', 'pyworld', 'utaupy']},
              'artifacts': artifacts}
    (output / 'validation.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--sifigan-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(benchmark(args.model.resolve(), args.sifigan_root.resolve(), args.output.resolve())))
