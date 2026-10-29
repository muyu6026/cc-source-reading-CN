import os, sys, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

RELPATHS = [
    'src/utils/managedEnvConstants.ts',
    'src/utils/hooks/fileChangedWatcher.ts',
    'src/utils/terminalPanel.ts',
    'src/utils/mcpOutputStorage.ts',
    'src/utils/promptEditor.ts',
    'src/utils/powershell/dangerousCmdlets.ts',
    'src/utils/genericProcessUtils.ts',
    'src/utils/exampleCommands.ts',
    'src/utils/envUtils.ts',
    'src/utils/promptShellExecution.ts',
]

for rel in RELPATHS:
    print('=== annotate', rel, '===')
    r = subprocess.run([sys.executable, 'scripts/annotate.py', rel], cwd=ROOT)
    if r.returncode != 0:
        print('FAILED', rel)
        sys.exit(1)
print('ALL DONE')
