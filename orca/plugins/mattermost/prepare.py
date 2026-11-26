#!/usr/bin/env python3
"""Bundle the canonical shared CLI before Orca copies this directory."""
from pathlib import Path
import shutil
root = Path(__file__).resolve().parent
source = root.parents[2] / 'skills/mattermost/scripts'
if not (source / 'mm.py').is_file():
    raise SystemExit('Run prepare.py in the cc-skills checkout before installing')
target = root / 'runtime'
target.mkdir(exist_ok=True)
for path in source.glob('*.py'):
    shutil.copy2(path, target / path.name)
print('Shared Mattermost CLI bundled in ' + str(target))
