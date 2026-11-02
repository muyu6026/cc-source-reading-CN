import ast
import importlib.util
import io
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

FILES = [
    'src/utils/swarm/leaderPermissionBridge.ts',
    'src/utils/deepLink/terminalPreference.ts',
    'src/utils/cliHighlight.ts',
    'src/utils/taggedId.ts',
    'src/utils/binaryCheck.ts',
    'src/utils/bash/registry.ts',
    'src/utils/idleTimeout.ts',
    'src/utils/computerUse/setup.ts',
    'src/utils/set.ts',
    'src/utils/displayTags.ts',
]


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_') + '_p1'


def block_comment_lines(text):
    """返回块注释「内部续行」的行号集合。

    首行（含 /*）与收尾行（含 */）不算内部：
    落首行用 (行号,'after') 脚本会整体外移，落收尾行用 (行号,'before') 也会前移。
    只有夹在中间的续行是危险的——插进去就劈开了英文原文。
    """
    inside = set()
    in_block = False
    for idx, line in enumerate(text.splitlines(), start=1):
        if in_block:
            if '*/' in line:
                in_block = False
            else:
                inside.add(idx)
            continue
        if '/*' in line:
            tail = line.split('/*', 1)[1]
            if '*/' not in tail:
                in_block = True
    return inside


failures = []
total_anchors = 0

for rel in FILES:
    src_path = os.path.join(ROOT, 'source', rel)
    data_path = os.path.join(ROOT, 'scripts', '_annot', slug_of(rel) + '.py')

    if not os.path.exists(src_path):
        failures.append(f'{rel}: 源文件不存在')
        continue
    if not os.path.exists(data_path):
        failures.append(f'{rel}: 数据文件不存在 {os.path.basename(data_path)}')
        continue

    src_text = io.open(src_path, encoding='utf-8').read()
    src_lines = src_text.splitlines()
    n = len(src_lines)

    py_text = io.open(data_path, encoding='utf-8').read()
    try:
        ast.parse(py_text)
    except SyntaxError as e:
        failures.append(f'{rel}: ast.parse 失败 {e}')
        continue

    spec = importlib.util.spec_from_file_location(slug_of(rel), data_path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        failures.append(f'{rel}: 加载失败 {e}')
        continue

    anns = getattr(mod, 'ANNOTATIONS', None)
    if not isinstance(anns, list) or not anns:
        failures.append(f'{rel}: ANNOTATIONS 缺失或为空')
        continue

    # slug 与源文件路径一一对应
    expected_slug = slug_of(rel)
    if os.path.basename(data_path)[:-3] != expected_slug:
        failures.append(f'{rel}: slug 不匹配')

    blocks = block_comment_lines(src_text)
    seen = set()
    for item in anns:
        if not (isinstance(item, tuple) and len(item) == 3):
            failures.append(f'{rel}: 元组形状错误 {item!r}')
            continue
        line_no, pos, text = item
        if pos not in ('before', 'after', 'after_block'):
            failures.append(f'{rel}: 非法 pos {pos} @ {line_no}')
        if not isinstance(line_no, int) or not (1 <= line_no <= n):
            failures.append(f'{rel}: 行号越界 {line_no}（源 {n} 行）')
        if (line_no, pos) in seen:
            failures.append(f'{rel}: 重复锚点 {(line_no, pos)}')
        seen.add((line_no, pos))
        if '"' in text:
            failures.append(f'{rel}: 批注含英文双引号 @ {line_no}')
        if '\\' in text:
            failures.append(f'{rel}: 批注含反斜杠 @ {line_no}')
        if not text.strip():
            failures.append(f'{rel}: 空批注 @ {line_no}')
        # 锚点落块注释内部硬拦（首尾行已排除；(1,'after') 属文件级锚点，脚本会外移）
        if pos in ('before', 'after') and line_no in blocks:
            failures.append(f'{rel}: 锚点落块注释内部 {(line_no, pos)}')
        if pos == 'after' and line_no != 1 and '*/' in src_lines[line_no - 1]:
            failures.append(f'{rel}: after 落 */ 收尾行 {line_no}')
        if pos == 'after' and line_no == 1 and '*/' in src_lines[0] and '/**' not in src_lines[0]:
            failures.append(f'{rel}: 单行块注释 after 落点不安全 {line_no}')
        total_anchors += 1

    print(f'  OK  {rel:<48} {n:>3} 行 / {len(anns)} 锚点')

print()
if failures:
    print(f'预检失败 {len(failures)} 项：')
    for f in failures:
        print('  FAIL', f)
    sys.exit(1)

print(f'预检全过：{len(FILES)} 份文件 / {total_anchors} 锚点')
