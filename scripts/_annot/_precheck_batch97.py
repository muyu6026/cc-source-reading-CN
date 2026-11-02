#!/usr/bin/env python3
# 预检脚本：batch 97
import ast
import os
import sys

SRC_ROOT = 'source'
ANNOT_DIR = 'scripts/_annot'

# slug -> 相对路径（与 annotate.py 约定一致）
MAP = {
    'src_utils_embeddedTools_ts': 'src/utils/embeddedTools.ts',
    'src_utils_github_ghAuthStatus_ts': 'src/utils/github/ghAuthStatus.ts',
    'src_utils_highlightMatch_tsx': 'src/utils/highlightMatch.tsx',
    'src_utils_bash_shellPrefix_ts': 'src/utils/bash/shellPrefix.ts',
    'src_utils_userPromptKeywords_ts': 'src/utils/userPromptKeywords.ts',
    'src_utils_getWorktreePathsPortable_ts': 'src/utils/getWorktreePathsPortable.ts',
    'src_utils_plugins_managedPlugins_ts': 'src/utils/plugins/managedPlugins.ts',
    'src_utils_uuid_ts': 'src/utils/uuid.ts',
    'src_utils_toolSchemaCache_ts': 'src/utils/toolSchemaCache.ts',
    'src_utils_telemetry_logger_ts': 'src/utils/telemetry/logger.ts',
}

VALID_POS = {'before', 'after', 'after_block'}


def block_interior_spans(src_lines):
    """返回处于块注释内部的行号集合（不含块首行与块尾行）。"""
    interior = set()
    in_block = False
    for i, line in enumerate(src_lines, start=1):
        # 粗略配对：统计本行 /* 与 */ 数量（不处理嵌套）
        opens = line.count('/*')
        closes = line.count('*/')
        if in_block:
            if closes > 0:
                # 块尾行不算内部
                if opens > 0:
                    # 同一行 /* ... */ ... 不常见，保守处理：若 /* 在 */ 之后才算新块
                    pass
                in_block = False
            else:
                interior.add(i)
        else:
            if opens > 0:
                if closes == 0:
                    in_block = True
                    interior.add(i)  # 块首行也记入候选，随后由豁免处理
                    # 但块首行不应算内部；下面在检查时单独豁免含 /* 的行
    # 重新做一遍精确配对，区分块首/块内/块尾
    interior.clear()
    in_block = False
    for i, line in enumerate(src_lines, start=1):
        opens = line.count('/*')
        closes = line.count('*/')
        if not in_block:
            if opens > 0:
                if closes == 0:
                    in_block = True
                    # 块首行（含 /*）豁免，不算内部
                else:
                    # 同行 /* */ 闭合，不算内部
                    pass
            # 无 /* 也无 */：普通行
        else:
            # 在块内
            if closes > 0:
                # 块尾行（含 */）豁免，不算内部
                if opens == 0:
                    in_block = False
                else:
                    # 罕见：块尾后又开新块
                    in_block = True
            else:
                interior.add(i)
    return interior


fail = 0
total_anchors = 0

for slug, rel in MAP.items():
    py = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(py):
        print(f'FAIL {slug}: data file missing {py}')
        fail += 1
        continue
    # ast.parse 数据文件本身
    try:
        tree = ast.parse(open(py, encoding='utf-8').read())
    except SyntaxError as e:
        print(f'FAIL {slug}: data file ast.parse error {e}')
        fail += 1
        continue
    # 取 ANNOTATIONS
    mod = ast.literal_eval(
        compile(
            open(py, encoding='utf-8').read(),
            py,
            'exec',
        ) if False else '{}'
    )
    # 直接 import
    import importlib.util
    spec = importlib.util.spec_from_file_location(slug, py)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        print(f'FAIL {slug}: data file exec error {e}')
        fail += 1
        continue
    ANN = getattr(mod, 'ANNOTATIONS', None)
    if not isinstance(ANN, list):
        print(f'FAIL {slug}: ANNOTATIONS not a list')
        fail += 1
        continue
    # 源文件只做字符串扫描（不 ast.parse 源文件）
    sp = os.path.join(SRC_ROOT, rel)
    with open(sp, encoding='utf-8') as f:
        src = f.read()
    src_lines = src.split('\n')
    nlines = len(src_lines)
    interior = block_interior_spans(src_lines)

    seen = set()
    for tup in ANN:
        total_anchors += 1
        if not (isinstance(tup, tuple) and len(tup) == 3):
            print(f'FAIL {slug}: bad tuple {tup!r}')
            fail += 1
            continue
        ln, pos, text = tup
        if pos not in VALID_POS:
            print(f'FAIL {slug}: bad pos {pos} at line {ln}')
            fail += 1
        if not (1 <= ln <= nlines):
            print(f'FAIL {slug}: line {ln} out of range (1..{nlines})')
            fail += 1
        if (ln, pos) in seen:
            print(f'FAIL {slug}: dup anchor (line {ln}, {pos})')
            fail += 1
        seen.add((ln, pos))
        if not isinstance(text, str):
            print(f'FAIL {slug}: text not str at line {ln}')
            fail += 1
        if '"' in text or '\\' in text:
            print(f'FAIL {slug}: forbidden char in text at line {ln}: {text[:40]!r}')
            fail += 1
        # 块注释内部检测（块首行与块尾行豁免；(1,'after') 豁免）
        is_block_open = '/*' in src_lines[ln - 1]
        is_block_close = '*/' in src_lines[ln - 1]
        if ln in interior and not (is_block_open or is_block_close):
            if not (ln == 1 and pos == 'after'):
                print(f'FAIL {slug}: anchor at line {ln} ({pos}) lands inside block comment interior')
                fail += 1

print(f'\nSUMMARY: {total_anchors} anchors, {fail} failures')
sys.exit(1 if fail else 0)
