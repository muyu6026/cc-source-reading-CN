# -*- coding: utf-8 -*-
import ast, importlib.util, os, re, sys

ROOT = 'D:/CC泄露源码分析'

FILES = [
    ('src/commands/rate-limit-options/rate-limit-options.tsx',
     'scripts/_annot/src_commands_rate_limit_options_rate_limit_options_tsx_p1.py'),
    ('src/bridge/trustedDevice.ts',
     'scripts/_annot/src_bridge_trustedDevice_ts_p1.py'),
    ('src/bridge/bridgePointer.ts',
     'scripts/_annot/src_bridge_bridgePointer_ts_p1.py'),
    ('src/constants/spinnerVerbs.ts',
     'scripts/_annot/src_constants_spinnerVerbs_ts_p1.py'),
    ('src/keybindings/parser.ts',
     'scripts/_annot/src_keybindings_parser_ts_p1.py'),
    ('src/bridge/bridgeEnabled.ts',
     'scripts/_annot/src_bridge_bridgeEnabled_ts_p1.py'),
    ('src/state/AppState.tsx',
     'scripts/_annot/src_state_AppState_tsx_p1.py'),
    ('src/commands/bridge-kick.ts',
     'scripts/_annot/src_commands_bridge_kick_ts_p1.py'),
    ('src/vim/types.ts',
     'scripts/_annot/src_vim_types_ts_p1.py'),
    ('src/skills/bundled/skillify.ts',
     'scripts/_annot/src_skills_bundled_skillify_ts_p1.py'),
]

VALID_POS = {'before', 'after', 'after_block'}


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')


def block_interiors(lines):
    interiors = set()
    open_at = None
    for i, line in enumerate(lines, start=1):
        s = line.strip()
        if open_at is None:
            if s.startswith('/*') and not s.endswith('*/'):
                open_at = i
        else:
            if s.endswith('*/'):
                for j in range(open_at + 1, i):
                    interiors.add(j)
                open_at = None
    return interiors


errors = []
warns = []
total = 0

for rel, data_path in FILES:
    slug = slug_of(rel)
    if slug not in data_path:
        errors.append('slug 不一致: %s vs %s' % (data_path, slug))
        continue
    if not os.path.exists(data_path):
        errors.append('缺少数据文件: %s' % data_path)
        continue
    try:
        ast.parse(open(data_path, encoding='utf-8').read())
    except SyntaxError as e:
        errors.append('%s: ast.parse 失败: %s' % (data_path, e))
        continue
    spec = importlib.util.spec_from_file_location('d', data_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    items = mod.ANNOTATIONS
    with open(os.path.join(ROOT, 'source', rel), encoding='utf-8') as f:
        src_lines = f.read().split('\n')
    nlines = len(src_lines)
    interiors = block_interiors(src_lines)
    seen = set()
    prev = 0
    for idx, t in enumerate(items):
        if not (isinstance(t, tuple) and len(t) == 3):
            errors.append('%s: 第 %d 条非三元组: %r' % (data_path, idx, t))
            continue
        ln, pos, text = t
        if pos not in VALID_POS:
            errors.append('%s: 第 %d 条 pos 非法: %r' % (data_path, idx, pos))
        if not isinstance(ln, int) or ln < 1 or ln > nlines:
            errors.append('%s: 第 %d 条行号越界 %r (源 %d 行)' % (data_path, idx, ln, nlines))
        if not isinstance(text, str) or not text.strip():
            errors.append('%s: 第 %d 条文本空' % (data_path, idx))
        else:
            if '"' in text:
                errors.append('%s: 第 %d 条含英文双引号' % (data_path, idx))
            if '\\' in text:
                errors.append('%s: 第 %d 条含反斜杠' % (data_path, idx))
        key = (ln, pos)
        if key in seen:
            errors.append('%s: 重复锚点 %r' % (data_path, key))
        seen.add(key)
        if ln < prev:
            errors.append('%s: [order] 第 %d 条行号 %d 小于前一条 %d' % (data_path, idx, ln, prev))
        prev = ln
        if pos in ('before', 'after') and ln in interiors:
            errors.append('%s: [bslot] 第 %d 条落在块注释内部 (行 %d)' % (data_path, idx, ln))
        if pos == 'before' and re.match(r'^\s*[}\])]\s*=', src_lines[ln - 1] if ln - 1 < len(src_lines) else ''):
            errors.append('%s: [split] 第 %d 条 before 落在解构续行 %r' % (data_path, idx, src_lines[ln - 1].strip()))
        stripped = src_lines[ln - 1].strip() if ln - 1 < len(src_lines) else ''
        if pos == 'after' and re.search(r'\} else\b|\} catch\b|\} finally\b|\} else if\b', stripped):
            warns.append('%s: [TAIL?] 第 %d 条 after 落在 %r' % (data_path, idx, stripped))
    total += len(items)
    print('  %-60s %d 锚点, 源 %d 行, OK' % (os.path.basename(data_path), len(items), nlines))

print()
print('合计 %d 锚点' % total)
if warns:
    print('软警告 (%d 处):' % len(warns))
    for w in warns:
        print('  ' + w)
print()
if errors:
    print('错误 (%d 处):' % len(errors))
    for e in errors:
        print('  ' + e)
    sys.exit(1)
print('预检全部通过')
