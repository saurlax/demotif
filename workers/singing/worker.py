"""JSON Lines interface to one warm native singer. No HTTP server or project writes."""
from __future__ import annotations
import contextlib
import json
from pathlib import Path
import sys
import time
from typing import Any
from native import NativeSinger


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> None:
    singer: NativeSinger | None = None
    loaded: tuple[str, str, str] | None = None
    for line in sys.stdin:
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            job = request['id']
            if request['protocol'] != 1:
                raise ValueError('Unsupported worker protocol')
            if request['action'] == 'shutdown':
                emit({'protocol': 1, 'id': job, 'event': 'stopped'})
                return
            profile = str(Path(request['profile']).resolve())
            device = request.get('device', 'cpu')
            signature = request.get('profile_fingerprint', '')
            if loaded != (profile, device, signature):
                emit({'protocol': 1, 'id': job, 'event': 'progress', 'stage': 'loading'})
                start = time.perf_counter()
                with contextlib.redirect_stdout(sys.stderr):
                    singer = NativeSinger(Path(profile), device)
                loaded = (profile, device, signature)
                emit({'protocol': 1, 'id': job, 'event': 'loaded', 'seconds': time.perf_counter() - start})
            if request['action'] == 'ready':
                emit({'protocol': 1, 'id': job, 'event': 'ready'})
                continue
            if request['action'] not in ('render', 'render_source'):
                raise ValueError('Unknown worker action')
            score = json.loads(Path(request['score_path']).read_text())
            emit({'protocol': 1, 'id': job, 'event': 'progress', 'stage': 'synthesis'})
            assert singer is not None
            if request['action'] == 'render_source':
                result = singer.render_source(score['source'], score['tempo'], Path(request['output_path']), int(request.get('seed', 1234)))
            else:
                result = singer.render(score, Path(request['output_path']), int(request.get('seed', 1234)))
            emit({'protocol': 1, 'id': job, 'event': 'complete', 'result': result})
        except Exception as error:
            emit({'protocol': 1, 'id': request.get('id'), 'event': 'error',
                  'error': {'type': type(error).__name__, 'message': str(error)}})


if __name__ == '__main__':
    main()
