"""Isolated native Japanese NNSVS adapter; no model or dictionary downloads."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from typing import Any
from japanese_score import compile_ust, phone_durations, resolve_readings


class JapaneseSinger:
    def __init__(self, profile_path: Path, device: str):
        self.profile = json.loads(profile_path.read_text(encoding='utf-8'))
        p = self.profile
        if p['engine'] != 'nnsvs' or p['language'] != 'ja' or device != 'cpu':
            raise ValueError('This validated Japanese voice requires the native CPU NNSVS engine')
        for artifact in p['artifacts']:
            with Path(artifact['path']).open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != artifact['sha256']:
                    raise ValueError('Japanese voice artifact changed; reinstall or revalidate the voice')
        sys.path.insert(0, p['reference_root'])
        import importlib.metadata
        import numpy as np
        import torch
        import pyopenjtalk
        import utaupy
        from nnsvs.svs import SPSVS
        if importlib.metadata.version('nnsvs') != p['nnsvs_version']:
            raise ValueError('Japanese voice runtime version does not match its profile')
        # Construct the frontend directly with an installed dictionary: unlike the
        # convenience singleton, this never silently downloads one on first use.
        self.frontend = pyopenjtalk.OpenJTalk(dn_mecab=p['dictionary_root'].encode('utf-8'))
        torch.set_num_threads(p['cpu_threads'])
        self.table = utaupy.table.load(str(Path(p['model_root']) / 'kana2phonemes.table'), encoding='utf-8')
        self.engine = SPSVS(Path(p['model_root']), device='cpu')
        self.context_key = ''
        self.readings: dict = {}

    def render_source(self, snapshot: dict[str, Any], output: Path, seed: int) -> dict:
        import numpy as np
        import torch
        import soundfile as sf
        import utaupy
        from nnmnkwii.io import hts
        source, tempo = snapshot['source'], snapshot['tempo']
        context = snapshot.get('source_context', source)
        key = json.dumps(context, ensure_ascii=False, sort_keys=True)
        if key != self.context_key:
            self.readings = resolve_readings(context, self.frontend.run_frontend)
            self.context_key = key
        ust_text, segments, alignment = compile_ust(source, context, tempo, self.readings, self.table, self.profile['intensity'])
        with tempfile.TemporaryDirectory() as directory:
            ust_path, label_path = Path(directory) / 'score.ust', Path(directory) / 'score.lab'
            ust_path.write_text(ust_text, encoding='utf-8')
            song = utaupy.utils.ustobj2songobj(utaupy.ust.load(str(ust_path), encoding='utf-8'), self.table)
            counts = [len(note.phonemes) for note in song]
            song.write(str(label_path), strict_sinsy_style=False)
            labels = hts.load(str(label_path))
        torch.manual_seed(seed)
        np.random.seed(seed)
        with torch.inference_mode():
            prediction = np.asarray(self.engine.predict_duration(labels)).reshape(-1)
            # Predicted phone proportions are constrained to each accepted note;
            # expressive timelag must not move clip boundaries or change rests.
            index, cursor = 0, 0.
            for segment, count in zip(segments, counts, strict=True):
                durations = phone_durations(segment, prediction[index:index + count].tolist(), 60 / tempo)
                for duration in durations:
                    labels.start_times[index] = round(cursor * 1e7)
                    cursor += duration
                    labels.end_times[index] = round(cursor * 1e7)
                    index += 1
            labels.frame_shift = round(float(self.engine.config.frame_period) * 10000)
            acoustic = self.engine.predict_acoustic(labels)
            features = self.engine.postprocess_acoustic(labels, acoustic)
            pcm = self.engine.predict_waveform(features, vocoder_type='usfgan')
            pcm = self.engine.postprocess_waveform(pcm, dtype=np.float32)
        pcm = np.asarray(pcm, dtype=np.float32).reshape(-1)
        rate = self.engine.sample_rate
        target = round(alignment.pop('duration_seconds') * rate)
        # Frame quantization can change at most one native 5-ms frame. Pad/trim
        # only that rounding error, rather than time stretching the performance.
        if abs(len(pcm) - target) > round(rate * .01):
            raise ValueError('Japanese inference duration differs from its accepted score')
        pcm = np.pad(pcm, (0, max(0, target - len(pcm))))[:target]
        if not np.isfinite(pcm).all() or not pcm.size or np.max(np.abs(pcm)) < 1e-5:
            raise ValueError('Japanese inference produced invalid or silent audio')
        volume = source['vocal'].get('volume', [])
        if volume:
            beats = (np.arange(len(pcm)) / rate + alignment['offset_seconds']) * tempo / 60
            pcm *= np.interp(beats, [p['beat'] for p in volume], [p['value'] for p in volume])
        if np.max(np.abs(pcm)) > 1:
            raise ValueError('Vocal expression clips the audio; lower the volume curve')
        sf.write(output, pcm, rate, subtype='FLOAT')
        return {'path': str(output.resolve()), 'sample_rate': rate, 'samples': len(pcm),
                'duration_seconds': len(pcm) / rate, 'alignment': alignment}
