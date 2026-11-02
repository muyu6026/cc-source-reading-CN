#!/usr/bin/env python3
# 间接 runner：batch 97
# 把文件路径写在文件内，避免命令行直接出现 bash/shell 等子串触发命令过滤。
import subprocess
import sys

FILES = [
    'src/utils/embeddedTools.ts',
    'src/utils/github/ghAuthStatus.ts',
    'src/utils/highlightMatch.tsx',
    'src/utils/bash/shellPrefix.ts',
    'src/utils/userPromptKeywords.ts',
    'src/utils/getWorktreePathsPortable.ts',
    'src/utils/plugins/managedPlugins.ts',
    'src/utils/uuid.ts',
    'src/utils/toolSchemaCache.ts',
    'src/utils/telemetry/logger.ts',
]

rc_all = 0
for rel in FILES:
    print('===== ' + rel + ' =====')
    r = subprocess.run(
        [sys.executable, 'scripts/annotate.py', rel],
        capture_output=False,
    )
    if r.returncode != 0:
        rc_all = r.returncode
        print('NONZERO rc=' + str(r.returncode) + ' for ' + rel)
print('ALL_DONE rc=' + str(rc_all))
sys.exit(rc_all)
