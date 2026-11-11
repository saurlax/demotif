"""Launch the pinned upstream CLI with an import-only decoder-registry bridge."""
import os
from pathlib import Path
import runpy
import sys
from native import legacy_inference_imports

if len(sys.argv) < 3:
    raise SystemExit('Usage: reference_cli.py <reference-root> <score> [options]')
root = Path(sys.argv.pop(1)).resolve()
os.chdir(root)
sys.path.insert(0, str(root))
import torch
torch.set_num_threads(4)
legacy_inference_imports()
runpy.run_path(str(root / 'main.py'), run_name='__main__')
