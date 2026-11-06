# -*- coding: utf-8 -*-
# 第 165 批预检：加载 15 个数据文件，按与 annotate.py 一致的口径校验。
import ast, importlib.util, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

MAPPING = [
    ('src/skills/bundled/batch.ts', 'scripts/_annot/src_skills_bundled_batch_ts_p1.py'),
    ('src/commands/plugin/PluginErrors.tsx', 'scripts/_annot/src_commands_plugin_PluginErrors_tsx_p1.py'),
    ('src/commands/plan/plan.tsx', 'scripts/_annot/src_commands_plan_plan_tsx_p1.py'),
    ('src/tasks/InProcessTeammateTask/types.ts', 'scripts/_annot/src_tasks_InProcessTeammateTask_types_ts_p1.py'),
    ('src/keybindings/match.ts', 'scripts/_annot/src_keybindings_match_ts_p1.py'),
    ('src/migrations/migrateEnableAllProjectMcpServersToSettings.ts', 'scripts/_annot/src_migrations_migrateEnableAllProjectMcpServersToSettings_ts_p1.py'),
    ('src/commands/extra-usage/extra-usage-core.ts', 'scripts/_annot/src_commands_extra_usage_extra_usage_core_ts_p1.py'),
    ('src/commands/plugin/pluginDetailsHelpers.tsx', 'scripts/_annot/src_commands_plugin_pluginDetailsHelpers_tsx_p1.py'),
    ('src/constants/tools.ts', 'scripts/_annot/src_constants_tools_ts_p1.py'),
    ('src/commands/add-dir/validation.ts', 'scripts/_annot/src_commands_add_dir_validation_ts_p1.py'),
    ('src/cli/handlers/util.tsx', 'scripts/_annot/src_cli_handlers_util_tsx_p1.py'),
    ('src/bridge/pollConfig.ts', 'scripts/_annot/src_bridge_pollConfig_ts_p1.py'),
    ('src/commands/advisor.ts', 'scripts/_annot/src_commands_advisor_ts_p1.py'),
    ('src/commands/login/login.tsx', 'scripts/_annot/src_commands_login_login_tsx_p1.py'),
    ('src/skills/bundled/debug.ts', 'scripts/_annot/src_skills_bundled_debug_ts_p1.py'),
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
total_anchors = 0

for rel, data_path in MAPPING:
    slug = slug_of(rel)
    assert slug in data_path, '数据文件名 slug 不一致: %s vs %s' % (data_path, slug)
    if not os.path.exists(data_path):
        errors.append('缺少数据文件: %s' % data_path)
        continue
    try:
        src_text = open(data_path, encoding='utf-8').read()
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append('%s: ast.parse 失败: %s' % (data_path, e))
        continue
    spec = importlib.util.spec_from_file_location('d', data_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    items = mod.ANNOTATIONS
    if not isinstance(items, list):
        errors.append('%s: ANNOTATIONS 非 list' % data_path)
        continue
    with open(os.path.join(ROOT, 'source', rel), encoding='utf-8') as f:
        src_lines = f.read().split('\n')
    nlines = len(src_lines)
    interiors = block_interiors(src_lines)
    seen = set()
    prev_ln = 0
    for idx, t in enumerate(items):
        if not (isinstance(t, tuple) and len(t) == 3):
            errors.append('%s: 第 %d 条非三元组: %r' % (data_path, idx, t))
            continue
        ln, pos, text = t
        if pos not in VALID_POS:
            errors.append('%s: 第 %d 条 pos 非法: %r' % (data_path, idx, pos))
        if not isinstance(ln, int) or ln < 1 or ln > nlines:
            errors.append('%s: 第 %d 条行号越界: %r (源 %d 行)' % (data_path, idx, ln, nlines))
        if not isinstance(text, str) or not text.strip():
            errors.append('%s: 第 %d 条文本空' % (data_path, idx))
        else:
            if '"' in text:
                errors.append('%s: 第 %d 条含英文双引号' % (data_path, idx))
            if '\\' in text:
                errors.append('%s: 第 %d 条含反斜杠' % (data_path, idx))
            if "'''" in text:
                errors.append('%s: 第 %d 条含三连单引号' % (data_path, idx))
        key = (ln, pos)
        if key in seen:
            errors.append('%s: 重复锚点 (行号,pos): %r' % (data_path, key))
        seen.add(key)
        if ln < prev_ln:
            errors.append('%s: [order] 第 %d 条行号 %d 小于前一条 %d（未升序）' % (data_path, idx, ln, prev_ln))
        prev_ln = ln
        if pos in ('before', 'after') and ln in interiors:
            errors.append('%s: [bslot] 第 %d 条落在 /* */ 块注释内部（行 %d）' % (data_path, idx, ln))
        if pos == 'before' and re.match(r'^\s*[}\])]\s*=', src_lines[ln - 1] if ln - 1 < len(src_lines) else ''):
            errors.append('%s: [split] 第 %d 条 before 落在解构续行 %r' % (data_path, idx, src_lines[ln - 1].strip()))
        stripped = src_lines[ln - 1].strip() if ln - 1 < len(src_lines) else ''
        if pos == 'after' and re.search(r'\} else\b|\} catch\b|\} finally\b|\} else if\b', stripped):
            warns.append('%s: [TAIL?] 第 %d 条 after 落在 %r（检查是否讲下一分支）' % (data_path, idx, stripped))
    total_anchors += len(items)
    print('  %s: %d 锚点, 源 %d 行, OK' % (rel, len(items), nlines))

print()
print('合计 %d 锚点' % total_anchors)
if warns:
    print('软警告 (%d 处，需人工确认):' % len(warns))
    for w in warns:
        print('  - ' + w)
if errors:
    print('预检失败 (%d 处):' % len(errors))
    for e in errors:
        print('  - ' + e)
    sys.exit(1)
else:
    print('预检全部通过（%d 个数据文件）。' % len(MAPPING))
