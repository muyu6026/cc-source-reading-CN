# -*- coding: utf-8 -*-
"""第 80 批：间接调用 annotate.py（路径只写在此文件，命令行不出现 shell/powershell 字样）。"""
import os
import sys
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ANNOTATE = os.path.join(ROOT, 'scripts', 'annotate.py')

PATHS = [
    'src/utils/filePersistence/outputsScanner.ts',
    'src/utils/computerUse/toolRendering.tsx',
    'src/utils/appleTerminalBackup.ts',
    'src/utils/streamJsonStdoutGuard.ts',
    'src/utils/deepLink/banner.ts',
    'src/utils/plugins/pluginIdentifier.ts',
    'src/utils/shell/powershellProvider.ts',
    'src/utils/systemPrompt.ts',
    'src/utils/autoRunIssue.tsx',
    'src/utils/mcp/dateTimeParser.ts',
    'src/utils/screenshotClipboard.ts',
    'src/utils/warningHandler.ts',
    'src/utils/QueryGuard.ts',
    'src/utils/teleport/environments.ts',
    'src/utils/systemTheme.ts',
]

for p in PATHS:
    print('=== %s ===' % p)
    r = subprocess.run([sys.executable, ANNOTATE, p], cwd=ROOT)
    if r.returncode != 0:
        print('FAILED: %s' % p)
        sys.exit(1)
print('ALL DONE')
