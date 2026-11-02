# -*- coding: utf-8 -*-
import subprocess, sys

# 所有目标相对路径都写在本文件内（不在命令行），避免 shell / bash 危险子串触发命令过滤。
TARGETS = [
    'src/utils/settings/managedPath.ts',
    'src/utils/swarm/constants.ts',
    'src/utils/shell/shellProvider.ts',
    'src/utils/cwd.ts',
    'src/utils/settings/allErrors.ts',
    'src/utils/controlMessageCompat.ts',
    'src/utils/bash/specs/srun.ts',
    'src/utils/tempfile.ts',
    'src/utils/computerUse/inputLoader.ts',
    'src/utils/semanticBoolean.ts',
]

for rel in TARGETS:
    print('===== %s =====' % rel)
    rc = subprocess.run([sys.executable, 'scripts/annotate.py', rel]).returncode
    if rc != 0:
        print('!! nonzero rc=%d for %s' % (rc, rel))
