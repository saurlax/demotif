"""Native DiffSinger reference adapter; imports heavy dependencies only on load."""
from __future__ import annotations

import contextlib
import copy
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import time
import types
from typing import Any


def digest_file(path: Path) -> str:
    """Hash a model or config without holding its contents in memory."""
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def legacy_inference_imports() -> None:
    """Expose upstream's decoder registry without importing its training UI.

    v1.5.0 imports this two-entry registry from a training task module. Both
    constructors below match that revision verbatim; no model math is changed.
    """
    from src.diff.net import DiffNet
    from src.diff.candidate_decoder import FFT

    registry = types.ModuleType('src.diffsinger_task')
    registry.DIFF_DECODERS = {
        'wavenet': lambda hp: DiffNet(hp['audio_num_mel_bins']),
        'fft': lambda hp: FFT(hp['hidden_size'], hp['dec_layers'], hp['dec_ffn_kernel_size'], hp['num_heads']),
    }
    sys.modules['src.diffsinger_task'] = registry
    # Its package initializer eagerly imports every vocoder, including unused PWG.
    # Load the original selected NSF module without those unrelated dependencies.
    package = types.ModuleType('src.vocoders')
    package.__path__ = [str(Path.cwd() / 'src/vocoders')]
    sys.modules['src.vocoders'] = package
    importlib.import_module('src.vocoders.nsf_hifigan')


class NativeSinger:
    """One warm, operator-installed reference voice per isolated worker process."""

    def __init__(self, profile_path: Path, device: str = 'cpu') -> None:
        print('Loading native PyTorch runtime', file=sys.stderr, flush=True)
        import torch

        self.profile = json.loads(profile_path.read_text())
        self.root = Path(self.profile['reference_root']).resolve()
        self.device = device
        print('Verifying native model artifacts', file=sys.stderr, flush=True)
        for artifact in self.profile['artifacts']:
            path = Path(artifact['path'])
            if digest_file(path) != artifact['sha256']:
                raise ValueError(f'Model/config digest changed: {path.name}')
        # Native upstream resolves configs/dictionaries relative to its checkout.
        os.chdir(self.root)
        sys.path.insert(0, str(self.root))
        torch.set_num_threads(self.profile.get('cpu_threads', 4))
        with contextlib.redirect_stdout(sys.stderr):
            print('Loading upstream inference modules', file=sys.stderr, flush=True)
            legacy_inference_imports()
            from utils.hparams import hparams, set_hparams
            set_hparams(config=str(self.root / 'checkpoints' / self.profile['experiment'] / 'config.yaml'),
                        exp_name=self.profile['experiment'], print_hparams=False)
            hparams['vocoder_ckpt'] = self.profile['vocoder_checkpoint']
            hparams['pndm_speedup'] = self.profile['sampling_speedup']
            from inference.ds_cascade import DiffSingerCascadeInfer
            print('Loading acoustic model and vocoder', file=sys.stderr, flush=True)
            self.singer = DiffSingerCascadeInfer(hparams, device=device)
            self.rate = int(hparams['audio_sample_rate'])
            self.hop = int(hparams['hop_size'])
            self.model_config = dict(hparams)
        self.torch = torch

    def render(self, score: dict[str, Any], destination: Path, seed: int = 1234,
               envelope: tuple[list[dict[str, float]], float, float] | None = None) -> dict[str, Any]:
        """Render a phoneme-level DS phrase using the original neural pipeline."""
        import numpy as np
        import soundfile as sf

        started = time.perf_counter()
        score = copy.deepcopy(score)
        requested_frames = sum(map(float, score['ph_dur'].split())) * self.rate / self.hop
        if requested_frames > self.model_config['max_frames']:
            raise ValueError('Phrase exceeds this model configuration; split it at a musical rest')
        score['spk_mix'] = {self.profile.get('speaker', 'opencpop'): 1.0}
        if not self.model_config.get('use_midi', False):
            from utils.slur_utils import merge_slurs
            merge_slurs(score)
        self.torch.manual_seed(seed)
        np.random.seed(seed & 0xffffffff)
        if self.device.startswith('cuda'):
            self.torch.cuda.manual_seed_all(seed)
        with contextlib.redirect_stdout(sys.stderr), self.torch.no_grad():
            pcm = np.asarray(self.singer.infer_once(score), dtype=np.float32)
        if pcm.ndim != 1 or not len(pcm) or not np.isfinite(pcm).all():
            raise ValueError('Native model returned invalid PCM')
        if envelope and envelope[0]:
            points, offset_seconds, beat_seconds = envelope
            beats = (np.arange(len(pcm)) / self.rate + offset_seconds) / beat_seconds
            gains = np.interp(beats, [p['beat'] for p in points], [p['value'] for p in points])
            pcm = (pcm * gains).astype(np.float32)
        destination = destination.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.partial.wav')
        sf.write(temporary, pcm, self.rate, subtype='FLOAT')
        temporary.replace(destination)
        elapsed = time.perf_counter() - started
        return {'path': str(destination), 'sample_rate': self.rate, 'hop': self.hop,
                'samples': len(pcm), 'duration_seconds': len(pcm) / self.rate,
                'render_seconds': elapsed, 'rtf': elapsed / (len(pcm) / self.rate),
                'peak': float(np.max(np.abs(pcm))), 'rms': float(np.sqrt(np.mean(pcm ** 2))),
                'seed': seed, 'device': self.device, 'torch_version': self.torch.__version__}

    def render_source(self, source: dict[str, Any], tempo: float, destination: Path,
                      seed: int = 1234) -> dict[str, Any]:
        from score import compile_phrase
        score, alignment = compile_phrase(source, tempo, self.singer.pinyin2phs)
        result = self.render(score, destination, seed,
                             (source['vocal'].get('volume', []), alignment['offset_seconds'], 60 / tempo))
        return {**result, 'alignment': alignment}
