# 预检：加载本批 15 个数据文件并断言各项约束
import importlib.util
import os
import ast

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# (slug, rel_path) 一一对应
BATCH = [
    ('src_commands_export_index_ts', 'src/commands/export/index.ts'),
    ('src_commands_config_index_ts', 'src/commands/config/index.ts'),
    ('src_commands_vim_index_ts', 'src/commands/vim/index.ts'),
    ('src_commands_hooks_index_ts', 'src/commands/hooks/index.ts'),
    ('src_commands_output_style_index_ts', 'src/commands/output-style/index.ts'),
    ('src_commands_ide_index_ts', 'src/commands/ide/index.ts'),
    ('src_commands_plan_index_ts', 'src/commands/plan/index.ts'),
    ('src_commands_add_dir_index_ts', 'src/commands/add-dir/index.ts'),
    ('src_commands_mobile_index_ts', 'src/commands/mobile/index.ts'),
    ('src_commands_tasks_tasks_tsx', 'src/commands/tasks/tasks.tsx'),
    ('src_commands_status_status_tsx', 'src/commands/status/status.tsx'),
    ('src_commands_diff_index_ts', 'src/commands/diff/index.ts'),
    ('src_commands_usage_usage_tsx', 'src/commands/usage/usage.tsx'),
    ('src_commands_remote_env_remote_env_tsx', 'src/commands/remote-env/remote-env.tsx'),
    ('src_commands_stats_stats_tsx', 'src/commands/stats/stats.tsx'),
]

POS_OK = {'before', 'after', 'after_block'}


def real_len(seq):
    return len(seq) - 1 if seq and seq[-1] == '' else len(seq)


def main():
    total_ann = 0
    errors = []
    for slug, rel in BATCH:
        # slug ↔ 源文件对应
        src = os.path.join(ROOT, 'source', rel)
        if not os.path.exists(src):
            errors.append('源文件不存在: %s' % src)
            continue
        with open(src, encoding='utf-8') as f:
            nlines = real_len(f.read().split('\n'))

        # 加载数据文件（importlib 已做 ast.parse）
        name = slug + '_p1.py'
        path = os.path.join(ANNOT_DIR, name)
        if not os.path.exists(path):
            errors.append('数据文件缺失: %s' % path)
            continue
        spec = importlib.util.spec_from_file_location(name[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except SyntaxError as e:
            errors.append('%s ast.parse 失败: %s' % (name, e))
            continue
        ann = mod.ANNOTATIONS

        seen = set()
        for lineno, pos, text in ann:
            total_ann += 1
            if pos not in POS_OK:
                errors.append('%s 非法 pos=%r' % (name, pos))
            if not (1 <= lineno <= nlines):
                errors.append('%s 行号越界 %d (文件 %d 行)' % (name, lineno, nlines))
            if (lineno, pos) in seen:
                errors.append('%s 重复锚点 (%d,%s)' % (name, lineno, pos))
            seen.add((lineno, pos))
            if '"' in text or '\\' in text:
                errors.append('%s 文本含禁用字符 " 或 \\ (行 %d)' % (name, lineno))

        print('  %-42s %2d 锚点 · 源 %2d 行 OK' % (rel, len(ann), nlines))

    print('\n合计 %d 锚点，%d 个错误' % (total_ann, len(errors)))
    for e in errors:
        print('  ✗', e)
    if errors:
        raise SystemExit(1)
    print('预检全部通过')


if __name__ == '__main__':
    main()
