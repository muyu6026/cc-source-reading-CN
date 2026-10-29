# -*- coding: utf-8 -*-
"""第 76 批：逐个跑 annotate.py，捕获输出中的 ⟳/⚠。"""
import subprocess
import sys

ROOT = 'D:/CC泄露源码分析'
PY = 'C:/Users/hugozenhu/.workbuddy/binaries/python/versions/3.13.12/python.exe'

paths = [
    'src/utils/thinking.ts',
    'src/utils/plugins/parseMarketplaceInput.ts',
    'src/utils/localInstaller.ts',
    'src/utils/githubRepoPathMapping.ts',
    'src/utils/model/validateModel.ts',
    'src/utils/debugFilter.ts',
    'src/utils/plugins/pluginVersioning.ts',
    'src/utils/model/agent.ts',
    'src/utils/path.ts',
    'src/utils/permissions/bypassPermissionsKillswitch.ts',
]

flags = {'⟳', '⚠'}
for p in paths:
    r = subprocess.run(
        [PY, 'scripts/annotate.py', p],
        cwd=ROOT, capture_output=True, text=True,
    )
    print('==== %s ====' % p)
    print(r.stdout.strip())
    if r.stderr.strip():
        print('STDERR:', r.stderr.strip())
    for line in (r.stdout + r.stderr).splitlines():
        if any(f in line for f in flags):
            print('  >>> 注意标记:', line.strip())
