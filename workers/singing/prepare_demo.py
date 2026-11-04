"""Inspect/extract official local archives and write a non-commercial demo profile."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import zipfile
from native import digest_file
from demo_scores import phrase


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    models = args.root.resolve() / 'data/models'
    reference = models / 'diffsinger-reference'
    archives = [models / 'downloads/0116_female_triplet_ds1000.zip',
                models / 'downloads/nsf_hifigan_20221211.zip']
    for path in archives:
        with zipfile.ZipFile(path) as archive:
            # Extraction is of pinned official archives; keep member paths inside checkpoints.
            target = (reference / 'checkpoints').resolve()
            for name in archive.namelist():
                if not (target / name).resolve().is_relative_to(target):
                    raise ValueError('Archive member escapes checkpoints directory')
            archive.extractall(target)
    experiment = '0116_female_triplet_ds1000'
    checkpoint_dir = reference / 'checkpoints' / experiment
    acoustic = next(checkpoint_dir.glob('*.ckpt'))
    vocoder = reference / 'checkpoints/nsf_hifigan/model'
    if not vocoder.is_file():
        raise ValueError('Official native vocoder checkpoint was not extracted')
    config_files = list(checkpoint_dir.glob('*.json')) + [checkpoint_dir / 'config.yaml',
                    checkpoint_dir / 'opencpop-strict.txt', reference / 'dictionaries/opencpop-strict.txt']
    artifacts = [{'path': str(p), 'sha256': digest_file(p)} for p in [acoustic, vocoder, vocoder.parent / 'config.json', *config_files]]
    profile = {'id': 'opencpop-native-demo', 'name': 'OpenCpop · research demo',
               'language': 'zh', 'speaker': 'opencpop', 'usage': 'non-commercial-demo-only',
               'reference_root': str(reference), 'experiment': experiment,
               'reference_revision': subprocess.check_output(['git', '-C', str(reference), 'rev-parse', 'HEAD'], text=True).strip(),
               'vocoder_checkpoint': str(vocoder), 'sampling_speedup': 10, 'cpu_threads': 4,
               'artifacts': artifacts,
               'archive_digests': [{'path': str(p), 'sha256': digest_file(p)} for p in archives],
               'terms': ['https://github.com/openvpi/DiffSinger/releases/tag/v1.5.0',
                         'https://openvpi.github.io/vocoders/'],
               'capabilities': {'manual_pitch': True, 'manual_phoneme_duration': True,
                                'automatic_pitch': False, 'automatic_phoneme_duration': False}}
    destination = models / 'opencpop-native-demo'
    destination.mkdir(exist_ok=True)
    (destination / 'profile.json').write_text(json.dumps(profile, indent=2))
    for seconds in [2, 5, 10]:
        (destination / f'demo-{seconds}s.ds').write_text(json.dumps(phrase(seconds), ensure_ascii=False))
    print(json.dumps({'profile': str(destination / 'profile.json'), 'artifacts': artifacts}, indent=2))


if __name__ == '__main__':
    main()
