# 预检：本批（src 散件 33→24 行档十五件套）15 个批注数据文件
import os, ast, importlib.util, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# slug -> 相对 source/ 的路径
PAIRS = {
    'src_commands_exit_exit_tsx': 'src/commands/exit/exit.tsx',
    'src_cli_ndjsonSafeStringify_ts': 'src/cli/ndjsonSafeStringify.ts',
    'src_commands_plugin_PluginTrustWarning_tsx': 'src/commands/plugin/PluginTrustWarning.tsx',
    'src_cli_exit_ts': 'src/cli/exit.ts',
    'src_commands_extra_usage_index_ts': 'src/commands/extra-usage/index.ts',
    'src_commands_install_slack_app_install_slack_app_ts': 'src/commands/install-slack-app/install-slack-app.ts',
    'src_skills_bundled_verify_ts': 'src/skills/bundled/verify.ts',
    'src_context_fpsMetrics_tsx': 'src/context/fpsMetrics.tsx',
    'src_commands_desktop_index_ts': 'src/commands/desktop/index.ts',
    'src_commands_feedback_index_ts': 'src/commands/feedback/index.ts',
    'src_moreright_useMoreRight_tsx': 'src/moreright/useMoreRight.tsx',
    'src_commands_bridge_index_ts': 'src/commands/bridge/index.ts',
    'src_commands_fast_index_ts': 'src/commands/fast/index.ts',
    'src_commands_feedback_feedback_tsx': 'src/commands/feedback/feedback.tsx',
    'src_constants_cyberRiskInstruction_ts': 'src/constants/cyberRiskInstruction.ts',
}

POS = {'before', 'after', 'after_block'}
errors = []


def load(slug):
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.ANNOTATIONS


for slug, rel in PAIRS.items():
    src = os.path.join(ROOT, 'source', rel)
    # ast 解析数据文件本身
    try:
        with open(os.path.join(ANNOT_DIR, slug + '_p1.py'), encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        errors.append(f'[{slug}] ast.parse 失败: {e}')
        continue
    # 源文件行数
    try:
        with open(src, encoding='utf-8', newline='') as f:
            raw = f.read()
        lines = raw.split('\n')
        # 末行空串不算行（与 wc -l 对齐）
        n = len(lines) - 1 if lines and lines[-1] == '' else len(lines)
    except FileNotFoundError:
        errors.append(f'[{slug}] 源文件不存在: {rel}')
        continue
    try:
        ann = load(slug)
    except Exception as e:
        errors.append(f'[{slug}] 加载失败: {e}')
        continue
    seen = set()
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append(f'[{slug}] 非法条目: {item!r}')
            continue
        lineno, pos, text = item
        if pos not in POS:
            errors.append(f'[{slug}] 行 {lineno} pos 非法: {pos!r}')
        if not (1 <= lineno <= n):
            errors.append(f'[{slug}] 行号越界: {lineno} (文件 {n} 行)')
        if (lineno, pos) in seen:
            errors.append(f'[{slug}] 重复锚点: ({lineno},{pos})')
        seen.add((lineno, pos))
        if '"' in text:
            errors.append(f'[{slug}] 行 {lineno} 文本含英文双引号')
        if '\\' in text:
            errors.append(f'[{slug}] 行 {lineno} 文本含反斜杠')
        if not isinstance(text, str) or not text.strip():
            errors.append(f'[{slug}] 行 {lineno} 文本为空或非字符串')

print(f'预检 {len(PAIRS)} 个数据文件，发现 {len(errors)} 处问题')
total = sum(len(load(s)) for s in PAIRS)
print(f'锚点总数: {total}')
for e in errors:
    print('  ERR', e)
sys.exit(1 if errors else 0)
