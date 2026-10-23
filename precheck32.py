import importlib.util, os, ast, sys
SRCS = [
 'src/tools/BashTool/readOnlyValidation.ts',
 'src/tools/BashTool/pathValidation.ts',
 'src/tools/BashTool/sedValidation.ts',
 'src/tools/BashTool/prompt.ts',
 'src/tools/BashTool/sedEditParser.ts',
 'src/tools/BashTool/bashCommandHelpers.ts',
 'src/tools/BashTool/utils.ts',
 'src/tools/BashTool/BashToolResultMessage.tsx',
 'src/tools/BashTool/UI.tsx',
 'src/tools/BashTool/shouldUseSandbox.ts',
 'src/tools/BashTool/commandSemantics.ts',
 'src/tools/BashTool/modeValidation.ts',
 'src/tools/BashTool/destructiveCommandWarning.ts',
 'src/tools/BashTool/commentLabel.ts',
 'src/tools/BashTool/toolName.ts',
]
def slug(p):
    return p.replace('/', '_').replace('.', '_').replace('-', '_')
fail = 0
total = 0
for p in SRCS:
    datafile = f'scripts/_annot/{slug(p)}_p1.py'
    if not os.path.exists(datafile):
        print(f'MISSING {datafile}'); fail += 1; continue
    src = os.path.join('source', p)
    n = len(open(src, encoding='utf-8').readlines())
    try:
        ast.parse(open(datafile, encoding='utf-8').read())
    except SyntaxError as e:
        print(f'SYNTAX ERROR {datafile}: {e}'); fail += 1; continue
    spec = importlib.util.spec_from_file_location('m', datafile)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    total += len(mod.ANNOTATIONS)
    for (ln, mode, text) in mod.ANNOTATIONS:
        if mode not in ('before', 'after', 'after_block'):
            print(f'BAD MODE {datafile}: {mode}'); fail += 1
        if not (1 <= ln <= n):
            print(f'OUT OF RANGE {datafile}: {ln} > {n}'); fail += 1
    print(f'OK {p}: {len(mod.ANNOTATIONS)} anchors / {n} lines')
print(f'FAILURES: {fail} / TOTAL ANCHORS: {total}')
sys.exit(1 if fail else 0)
