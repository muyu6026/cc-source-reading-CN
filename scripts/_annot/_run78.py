# 第 78 批：调用 annotate.py 逐个生成批注（路径只在文件内，不进命令行）
import os
import subprocess
import sys

ROOT = 'D:/CC泄露源码分析'
ANNOTATE = os.path.join(ROOT, 'scripts', 'annotate.py')

TARGETS = [
    'src/utils/fileStateCache.ts',
    'src/utils/permissions/PermissionMode.ts',
    'src/utils/hooks/apiQueryHookHelper.ts',
    'src/utils/processUserInput/processBashCommand.tsx',
    'src/utils/sessionIngressAuth.ts',
    'src/utils/horizontalScroll.ts',
    'src/utils/deepLink/protocolHandler.ts',
    'src/utils/generatedFiles.ts',
    'src/utils/http.ts',
    'src/utils/plugins/fetchTelemetry.ts',
    'src/utils/sdkEventQueue.ts',
    'src/utils/sessionActivity.ts',
    'src/utils/hooks/hooksConfigSnapshot.ts',
    'src/utils/toolErrors.ts',
    'src/utils/terminal.ts',
]

flagged = []
for rel in TARGETS:
    r = subprocess.run(
        [sys.executable, ANNOTATE, rel],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    out = (r.stdout or '') + (r.stderr or '')
    print(f'--- {rel} (exit {r.returncode}) ---')
    # 只打印含提示的行
    for ln in out.splitlines():
        if any(t in ln for t in ('⟳', '⚠', 'error', 'Error', 'FAIL', 'Traceback')):
            print('   ', ln)
    if '⟳' in out:
        flagged.append((rel, '⟳'))
    if '⚠' in out:
        flagged.append((rel, '⚠'))

print('=== 完成 ===')
if flagged:
    print('出现外移/告警的文件：')
    for rel, t in flagged:
        print('  ', t, rel)
else:
    print('零 ⟳、零 ⚠')
