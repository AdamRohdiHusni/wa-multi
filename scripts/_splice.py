#!/usr/bin/env python3
import sys, json
ROOT = '/home/suki/server-stack/wa-multi'
mod = open(f'{ROOT}/scripts/v260-features.js', encoding='utf8').read().rstrip() + '\n'
mp = f'{ROOT}/main.js'
src = open(mp, encoding='utf8').read()

anchor = "// prefs defaults\nif (!prefs.tabMode)"
assert src.count(anchor) == 1, f'anchor count={src.count(anchor)}'
assert 'FEATURES: chat initials' not in src, 'sudah di-splice sebelumnya'

src = src.replace(anchor, mod + "\n" + anchor)
open(mp, 'w', encoding='utf8').write(src)
print('SPLICE OK — main.js lines:', src.count('\n') + 1)