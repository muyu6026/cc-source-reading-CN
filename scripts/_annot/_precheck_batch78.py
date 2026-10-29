# 预检脚本（第 78 批）：仅校验本批 15 个数据文件
import ast
import importlib.util
import os
import sys

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

VALID_POS = {'before', 'after', 'after_block'}
BAD = []

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


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')


def load(rel):
    stem = slug_of(rel)
    f = os.path.join(ANNOT_DIR, stem + '_p1.py')
    if not os.path.exists(f):
        BAD.append(f'{rel}: 数据文件缺失 {stem}_p1.py')
        return None
    spec = importlib.util.spec_from_file_location('mod_' + stem, f)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa
        BAD.append(f'{rel}: IMPORT ERROR {e!r}')
        return None
    with open(f, 'r', encoding='utf-8') as fh:
        src_text = fh.read()
    try:
        ast.parse(src_text)
    except SyntaxError as e:
        BAD.append(f'{rel}: AST PARSE FAIL {e}')
        return None
    if getattr(mod, 'SOURCE_REL', None) != rel:
        BAD.append(f'{rel}: SOURCE_REL 不匹配')
    return mod


total = 0
for rel in TARGETS:
    mod = load(rel)
    if mod is None:
        continue
    src_path = os.path.join(SOURCE_DIR, rel)
    with open(src_path, 'r', encoding='utf-8') as fh:
        nlines = len(fh.read().splitlines())
    anns = getattr(mod, 'ANNOTATIONS', None)
    if not isinstance(anns, list):
        BAD.append(f'{rel}: ANNOTATIONS 非列表')
        continue
    seen = set()
    for tup in anns:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            BAD.append(f'{rel}: 元组格式错 {tup!r}')
            continue
        line, pos, text = tup
        if pos not in VALID_POS:
            BAD.append(f'{rel}: 非法 pos {pos} @line {line}')
        if not (isinstance(line, int) and 1 <= line <= nlines):
            BAD.append(f'{rel}: 越界行号 {line} (源文件 {nlines} 行)')
        if not isinstance(text, str) or ('"' in text) or ('\\' in text):
            BAD.append(f'{rel}: 文本含 " 或 \\ @line {line}: {text[:30]!r}')
        key = (line, pos)
        if key in seen:
            BAD.append(f'{rel}: 重复锚点 {(line, pos)}')
        seen.add(key)
    total += len(anns)

if BAD:
    print('=== 预检失败 ===')
    for b in BAD:
        print(' -', b)
    sys.exit(1)
else:
    print(f'=== 预检全部通过：{len(TARGETS)} 个文件，合计 {total} 锚点 ===')
