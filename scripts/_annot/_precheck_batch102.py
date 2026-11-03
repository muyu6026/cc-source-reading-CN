import importlib.util, glob, os, ast, sys

SRC_ROOT = 'source'  # rel 已含 src/，路径为 source/src/...
ANNOT_DIR = 'scripts/_annot'

# slug -> source 相对路径
FILES = {
    'src_utils_lazySchema_ts': 'src/utils/lazySchema.ts',
    'src_utils_memory_versions_ts': 'src/utils/memory/versions.ts',
    'src_utils_messagePredicates_ts': 'src/utils/messagePredicates.ts',
}

def block_interior_lines(src_lines):
    """返回落在 /* */ 块注释内部的行号集合（不含块首 /** 行与块尾 */ 行）。"""
    inside = False
    interior = set()
    for i, ln in enumerate(src_lines, 1):
        s = ln.strip()
        opens = s.startswith('/**') or ('/*' in ln and not s.startswith('//'))
        closes = s.endswith('*/')
        if not inside and opens:
            if not closes:
                inside = True
            # 块首行豁免
            continue
        if inside:
            if closes:
                inside = False
                # 块尾行豁免
                continue
            interior.add(i)
    return interior

fail = 0
total_anchors = 0
for slug, rel in FILES.items():
    py = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(py):
        print(f'FAIL {slug}: 数据文件缺失 {py}')
        fail += 1
        continue
    spec = importlib.util.spec_from_file_location('m', py)
    m = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(m)
    except Exception as e:
        print(f'FAIL {slug}: 数据文件 import 错误 {e}')
        fail += 1
        continue
    try:
        ast.parse(open(py, encoding='utf-8').read())
    except SyntaxError as e:
        print(f'FAIL {slug}: ast.parse 失败 {e}')
        fail += 1
        continue
    sp = os.path.join(SRC_ROOT, rel)
    src_lines = open(sp, encoding='utf-8').read().split('\n')
    nlines = len(src_lines)
    interior = block_interior_lines(src_lines)
    seen = set()
    for (line, pos, text) in m.ANNOTATIONS:
        total_anchors += 1
        if pos not in ('before', 'after', 'after_block'):
            print(f'FAIL {slug}: pos={pos!r} 非法 @行{line}')
            fail += 1
        if not (1 <= line <= nlines):
            print(f'FAIL {slug}: 行号 {line} 超出范围 1..{nlines}')
            fail += 1
        if (line, pos) in seen:
            print(f'FAIL {slug}: 重复锚点 (行{line},{pos})')
            fail += 1
        seen.add((line, pos))
        if '"' in text or '\\' in text:
            print(f'FAIL {slug}: 文本含禁用字符 " 或 \\ @行{line}')
            fail += 1
        # 块注释内部检测（豁免 (1,after) 与块首/块尾行）
        if (line, pos) != (1, 'after') and line in interior:
            print(f'FAIL {slug}: 锚点落在块注释内部 @行{line}（pos={pos}）')
            fail += 1

print(f'预检完成：{total_anchors} 锚点，{fail} 个问题')
sys.exit(1 if fail else 0)
