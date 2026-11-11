"""Protocol 1 JSON Lines entry point for the optional native Japanese engine."""
from __future__ import annotations
import contextlib
import json
from pathlib import Path
import sys
from typing import Any
from nnsvs_native import JapaneseSinger


def emit(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main() -> None:
    singer = None
    loaded = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            job = request['id']
            if request['protocol'] != 1:
                raise ValueError('Unsupported worker protocol')
            action = request['action']
            if action == 'shutdown':
                emit({'protocol': 1, 'id': job, 'event': 'stopped'})
                return
            if action not in {'ready', 'render_source'}:
                raise ValueError('Unknown Japanese worker action')
            signature = (request['profile'], request.get('device', 'cpu'), request.get('profile_fingerprint', ''))
            if loaded != signature:
                emit({'protocol': 1, 'id': job, 'event': 'progress', 'stage': 'loading'})
                with contextlib.redirect_stdout(sys.stderr):
                    singer = JapaneseSinger(Path(signature[0]), signature[1])
                loaded = signature
            if action == 'ready':
                emit({'protocol': 1, 'id': job, 'event': 'ready'})
                continue
            emit({'protocol': 1, 'id': job, 'event': 'progress', 'stage': 'synthesis'})
            with contextlib.redirect_stdout(sys.stderr):
                snapshot = json.loads(Path(request['score_path']).read_text(encoding='utf-8'))
                result = singer.render_source(snapshot, Path(request['output_path']), int(request.get('seed', 1234)))
            emit({'protocol': 1, 'id': job, 'event': 'complete', 'result': result})
        except Exception as error:
            emit({'protocol': 1, 'id': request.get('id'), 'event': 'error',
                  'error': {'type': type(error).__name__, 'message': str(error)}})


if __name__ == '__main__':
    main()
