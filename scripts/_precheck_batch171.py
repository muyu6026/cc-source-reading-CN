# 预检脚本：src 第 171 批（44–52 行档 15 件套）
# 校验维度：slug↔源一一对应、pos 合法、行号范围、重复锚点、
# 禁字符（" \ 三单引号）、ast.parse、升序、JSDoc 块内、解构续行、TAIL 软警。
import importlib.util
import ast
import re
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPPING = [
    ('src/constants/betas.ts', 'scripts/_annot/src_constants_betas_ts_p1.py'),
    ('src/migrations/resetAutoModeOptInForDefaultOffer.ts', 'scripts/_annot/src_migrations_resetAutoModeOptInForDefaultOffer_ts_p1.py'),
    ('src/migrations/resetProToOpusDefault.ts', 'scripts/_annot/src_migrations_resetProToOpusDefault_ts_p1.py'),
    ('src/commands/release-notes/release-notes.ts', 'scripts/_annot/src_commands_release_notes_release_notes_ts_p1.py'),
    ('src/commands/pr_comments/index.ts', 'scripts/_annot/src_commands_pr_comments_index_ts_p1.py'),
    ('src/commands/sandbox-toggle/index.ts', 'scripts/_annot/src_commands_sandbox_toggle_index_ts_p1.py'),
    ('src/migrations/migrateSonnet1mToSonnet45.ts', 'scripts/_annot/src_migrations_migrateSonnet1mToSonnet45_ts_p1.py'),
    ('src/bridge/bridgeConfig.ts', 'scripts/_annot/src_bridge_bridgeConfig_ts_p1.py'),
    ('src/tasks/types.ts', 'scripts/_annot/src_tasks_types_ts_p1.py'),
    ('src/query/config.ts', 'scripts/_annot/src_query_config_ts_p1.py'),
    ('src/migrations/migrateFennecToOpus.ts', 'scripts/_annot/src_migrations_migrateFennecToOpus_ts_p1.py'),
    ('src/constants/figures.ts', 'scripts/_annot/src_constants_figures_ts_p1.py'),
    ('src/cli/transports/transportUtils.ts', 'scripts/_annot/src_cli_transports_transportUtils_ts_p1.py'),
    ('src/skills/mcpSkillBuilders.ts', 'scripts/_annot/src_skills_mcpSkillBuilders_ts_p1.py'),
    ('src/types/ids.ts', 'scripts/_annot/src_types_ids_ts_p1.py'),
]

POS_VALID = {'before', 'after', 'after_block'}
errors = 0
warns = 0
total_anchors = 0


def load(path):
    spec = importlib.util.spec_from_file_location('m', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def jsdoc_blocks(lines):
    """返回 JSDoc 块区间列表 [(a, b)]，a=/** 行, b=*/ 行。"""
    blocks = []
    i = 0
    n = len(lines)
    while i < n:
        if lines[i].lstrip().startswith('/**') and not lines[i].rstrip().endswith('*/'):
            a = i + 1
            j = i + 1
            while j < n and not lines[j].rstrip().endswith('*/'):
                j += 1
            if j < n:
                blocks.append((a + 1, j + 1))  # 1-based interior range (exclusive of opener/closer)
            i = j + 1
        else:
            i += 1
    return blocks


for rel, dp in MAPPING:
    src_path = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(src_path):
        print(f'[ERR] 源文件不存在: {src_path}')
        errors += 1
        continue
    with open(src_path, encoding='utf-8') as f:
        src_lines = f.read().split('\n')
    src_n = len(src_lines)

    try:
        m = load(os.path.join(ROOT, dp))
    except Exception as e:
        print(f'[ERR] {rel}: 导入失败 {e}')
        errors += 1
        continue

    A = getattr(m, 'ANNOTATIONS', None)
    if A is None:
        print(f'[ERR] {rel}: 缺少 ANNOTATIONS')
        errors += 1
        continue

    total_anchors += len(A)
    seen = set()
    blocks = jsdoc_blocks(src_lines)
    prev = (0, '')
    for t in A:
        if not (isinstance(t, tuple) and len(t) == 3):
            print(f'[ERR] {rel}: 锚点格式错误 {t}')
            errors += 1
            continue
        line, pos, text = t
        # pos
        if pos not in POS_VALID:
            print(f'[ERR] {rel}:{line} pos 非法 {pos}')
            errors += 1
        # line range
        if not (1 <= line <= src_n):
            print(f'[ERR] {rel}:{line} 行号越界 (1..{src_n})')
            errors += 1
        # duplicate
        key = (line, pos)
        if key in seen:
            print(f'[ERR] {rel}:{line} 重复锚点 (line,pos)={key}')
            errors += 1
        seen.add(key)
        # forbidden chars
        if '"' in text or '\\' in text or "'''" in text:
            print(f'[ERR] {rel}:{line} 含禁字符（" \\ 或三单引号）')
            errors += 1
        # ast.parse on triple-quoted
        try:
            ast.parse('"""' + text + '"""')
        except Exception as e:
            print(f'[ERR] {rel}:{line} ast.parse 失败 {e}')
            errors += 1
        # order
        cur = (line, pos)
        if prev > cur:
            print(f'[ERR] {rel}: 锚点未按 (line,pos) 升序: {prev} -> {cur}')
            errors += 1
        prev = cur
        # bslot: interior of JSDoc
        for (a, b) in blocks:
            if a < line < b:
                print(f'[ERR] {rel}:{line} 落在 JSDoc 块内 [{a},{b}] (bslot)')
                errors += 1
        # split: destructuring continuation
        raw = src_lines[line - 1]
        if re.match(r'^\s*[}\])]\s*=', raw):
            print(f'[WARN] {rel}:{line} 解构续行 `}} =` 锚点（split）')
            warns += 1
        # TAIL: } else / } catch / } finally
        if re.match(r'^\s*\}\s*(else|catch|finally)\b', raw):
            print(f'[WARN] {rel}:{line} TAIL 行锚点（}} else/catch/finally）')
            warns += 1

print(f'\n=== 预检完成：{len(MAPPING)} 文件 / {total_anchors} 锚点 / {errors} 错 / {warns} 警 ===')
sys.exit(1 if errors else 0)
