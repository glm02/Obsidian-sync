"""Construit les pièces jointes Obsidian/BRAT, sans donnée de coffre ni dépendance."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
assert manifest == json.loads((root / 'plugin/manifest.json').read_text(encoding='utf-8')), 'Les deux manifests divergent'
assert re.fullmatch(r'[a-z-]+', manifest['id']) and 'obsidian' not in manifest['id']
assert re.fullmatch(r'\d+\.\d+\.\d+', manifest['version'])
assert manifest['name'].isascii(), 'Le nom du catalogue doit utiliser Basic Latin'
assert len(manifest['description']) <= 250 and manifest['description'].endswith('.')
versions = json.loads((root / 'versions.json').read_text(encoding='utf-8'))
assert versions[manifest['version']] == manifest['minAppVersion']
out = root / 'dist' / manifest['version']
out.mkdir(parents=True, exist_ok=True)
assets = ['main.js', 'manifest.json']
if (root / 'plugin/styles.css').exists():
    assets.append('styles.css')
for name in assets:
    shutil.copyfile(root / 'plugin' / name, out / name)
with zipfile.ZipFile(out / 'cordee.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in assets:
        archive.write(out / name, 'cordee/' + name)
checksums = []
for name in assets + ['cordee.zip']:
    checksums.append(hashlib.sha256((out / name).read_bytes()).hexdigest() + '  ' + name)
(out / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='ascii')
print(f"Release {manifest['version']} : {', '.join(assets)}, cordee.zip et SHA256SUMS.txt prêts.")
