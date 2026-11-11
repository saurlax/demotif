"""Register operator-provided, locally validated NNSVS files without downloads."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def register(model: Path, sifigan: Path, dictionary: Path, report: Path, output: Path) -> dict:
    validation = json.loads(report.read_text(encoding='utf-8'))
    if validation['peak'] < 1e-5 or validation['rms'] <= 0 or validation['packages']['nnsvs'] != '0.1.1':
        raise ValueError('Run the native Japanese benchmark before registering this voice')
    artifacts = []
    for root, paths in [(model, sorted(model.iterdir())), (sifigan, sorted((sifigan / 'sifigan').rglob('*.py'))),
                        (dictionary, sorted(dictionary.iterdir()))]:
        for path in paths:
            if path.is_file() and (root != model or path.suffix in {'.pth', '.yaml', '.npy', '.hed', '.table'}):
                checksum = digest(path)
                if root == model and not any(a['name'] == path.name and a['sha256'] == checksum for a in validation['artifacts']):
                    raise ValueError(f'Revalidate changed model file: {path.name}')
                artifacts.append({'path': str(path), 'sha256': checksum})
    profile = {'engine': 'nnsvs', 'id': 'ritsu-crisscross-2824-ja', 'name': '波音リツ · CRISSCROSS 2824',
               'language': 'ja', 'usage': 'Namine Ritsu / Canon · CRISSCROSS 2824 · https://www.canon-voice.com/terms/',
               'reference_revision': 'SiFiGAN-cdb20daeb4da4a126077819091706ee90522c7a8',
               'cpu_threads': 2, 'model_root': str(model), 'reference_root': str(sifigan),
               'dictionary_root': str(dictionary), 'validation_report': str(report),
               'nnsvs_version': '0.1.1', 'intensity': '0030', 'artifacts': artifacts,
               'capabilities': {'manual_pitch': False, 'manual_phoneme_duration': True,
                                'automatic_pitch': True, 'automatic_phoneme_duration': True}}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding='utf-8')
    return profile


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['model', 'sifigan', 'dictionary', 'report', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    profile = register(*(getattr(args, name).resolve() for name in ['model', 'sifigan', 'dictionary', 'report', 'output']))
    print(json.dumps({'id': profile['id'], 'artifacts': len(profile['artifacts'])}))
