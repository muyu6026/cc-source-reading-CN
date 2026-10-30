import subprocess, sys, os

ROOT = 'D:/CC泄露源码分析'
paths = [
    'src/utils/swarm/reconnection.ts',
    'src/utils/suggestions/shellHistoryCompletion.ts',
    'src/utils/model/configs.ts',
    'src/utils/model/modelCapabilities.ts',
    'src/utils/staticRender.tsx',
    'src/utils/secureStorage/keychainPrefetch.ts',
    'src/utils/caCerts.ts',
    'src/utils/plugins/orphanedPluginFilter.ts',
    'src/utils/secureStorage/macOsKeychainHelpers.ts',
    'src/utils/shell/powershellDetection.ts',
    'src/utils/swarm/teammateLayoutManager.ts',
    'src/utils/computerUse/mcpServer.ts',
    'src/utils/ghPrStatus.ts',
    'src/utils/pasteStore.ts',
    'src/utils/imageValidation.ts',
]

log_path = os.path.join(ROOT, 'scripts', '_annot', '_run81.log')
lines_out = []
for p in paths:
    r = subprocess.run(
        [sys.executable, 'scripts/annotate.py', p],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    out = r.stdout
    lines_out.append(f'=== {p} (rc={r.returncode}) ===')
    lines_out.append(out)
    if r.returncode != 0:
        lines_out.append('STDERR: ' + r.stderr)
    # flag markers
    for marker in ('⟳', '⚠', 'ERROR', 'Traceback'):
        if marker in out or marker in r.stderr:
            lines_out.append(f'  >>> MARKER {marker!r} present')

with open(log_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines_out))

print('\n'.join(lines_out))
print('\nLOG WRITTEN TO', log_path)
