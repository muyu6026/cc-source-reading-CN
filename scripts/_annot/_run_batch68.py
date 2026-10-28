# -*- coding: utf-8 -*-
# 批 68 运行器：逐个调用 annotate.py，路径只存在于本文件，不进命令行。
import subprocess, sys, os

ROOT = 'D:/CC泄露源码分析'
ANN = os.path.join(ROOT, 'scripts', 'annotate.py')

FILES = [
    'src/utils/hooks/execHttpHook.ts',
    'src/utils/shell/specPrefix.ts',
    'src/utils/asciicast.ts',
    'src/utils/errors.ts',
    'src/utils/desktopDeepLink.ts',
    'src/utils/contextSuggestions.ts',
    'src/utils/background/remote/preconditions.ts',
    'src/utils/stringUtils.ts',
    'src/utils/errorLogSink.ts',
    'src/utils/permissions/shadowedRuleDetection.ts',
]

for f in FILES:
    print('==== %s ====' % f)
    r = subprocess.run(
        [sys.executable, ANN, f],
        cwd=ROOT,
        capture_output=True, text=True,
    )
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    if r.returncode != 0:
        print('NONZERO EXIT for', f)
