#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 79 批：间接调用 annotate.py（路径只写在此文件，命令行不出现 bash/shell 字样）。"""
import os
import sys
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ANNOTATE = os.path.join(ROOT, 'scripts', 'annotate.py')

PATHS = [
    'src/utils/settings/mdm/rawRead.ts',
    'src/utils/mcpInstructionsDelta.ts',
    'src/utils/glob.ts',
    'src/utils/swarm/teammateInit.ts',
    'src/utils/sessionTitle.ts',
    'src/utils/swarm/backends/detection.ts',
    'src/utils/bash/shellQuoting.ts',
    'src/utils/ultraplan/keyword.ts',
    'src/utils/permissions/PermissionPromptToolResultSchema.ts',
    'src/utils/plugins/pluginBlocklist.ts',
]

for p in PATHS:
    print('=== %s ===' % p)
    r = subprocess.run([sys.executable, ANNOTATE, p], cwd=ROOT)
    if r.returncode != 0:
        print('FAILED: %s' % p)
        sys.exit(1)
print('ALL DONE')
