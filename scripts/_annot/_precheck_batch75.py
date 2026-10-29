# -*- coding: utf-8 -*-
"""批次 75 预检：逐个加载数据文件，断言结构正确。"""
import ast
import importlib.util
import io
import os

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# (数据文件名（不含 .py）, 相对 source/ 的源路径)
EXPECTED = [
    ('src_utils_model_modelAllowlist_ts_p1', 'src/utils/model/modelAllowlist.ts'),
    ('src_utils_shellConfig_ts_p1', 'src/utils/shellConfig.ts'),
    ('src_utils_imageStore_ts_p1', 'src/utils/imageStore.ts'),
    ('src_utils_sessionEnvironment_ts_p1', 'src/utils/sessionEnvironment.ts'),
    ('src_utils_textHighlighting_ts_p1', 'src/utils/textHighlighting.ts'),
    ('src_utils_completionCache_ts_p1', 'src/utils/completionCache.ts'),
    ('src_utils_model_modelStrings_ts_p1', 'src/utils/model/modelStrings.ts'),
    ('src_utils_activityManager_ts_p1', 'src/utils/activityManager.ts'),
    ('src_utils_plugins_hintRecommendation_ts_p1', 'src/utils/plugins/hintRecommendation.ts'),
    ('src_utils_settings_validationTips_ts_p1', 'src/utils/settings/validationTips.ts'),
    ('src_utils_plugins_zipCacheAdapters_ts_p1', 'src/utils/plugins/zipCacheAdapters.ts'),
]

POS = {'before', 'after', 'after_block'}
BAD = 0


def load(mod_name, rel):
    global BAD
    path = os.path.join(ANNOT_DIR, mod_name + '.py')
    if not os.path.exists(path):
        print('MISSING %s' % path)
        BAD += 1
        return
    # ast.parse 整文件
    src = io.open(path, encoding='utf-8').read()
    try:
        ast.parse(src)
    except SyntaxError as e:
        print('AST FAIL %s: %s' % (mod_name, e))
        BAD += 1
        return
    spec = importlib.util.spec_from_file_location(mod_name, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa
        print('EXEC FAIL %s: %s' % (mod_name, e))
        BAD += 1
        return

    # SOURCE_PATH 必须一致
    if getattr(mod, 'SOURCE_PATH', None) != rel:
        print('BAD SOURCE_PATH %s: %r != %r' % (mod_name, getattr(mod, 'SOURCE_PATH', None), rel))
        BAD += 1

    # 源文件行数
    fpath = os.path.join(ROOT, 'source', rel)
    with io.open(fpath, encoding='utf-8') as f:
        lines = f.read().split('\n')
    n = len(lines) - 1 if lines and lines[-1] == '' else len(lines)

    anns = mod.ANNOTATIONS
    if not isinstance(anns, list):
        print('BAD ANNOTATIONS type %s' % mod_name)
        BAD += 1
        return
    seen = set()
    for t in anns:
        if not (isinstance(t, tuple) and len(t) == 3):
            print('BAD TUPLE %s: %r' % (mod_name, t))
            BAD += 1
            continue
        ln, pos, text = t
        if not isinstance(ln, int) or not isinstance(pos, str) or not isinstance(text, str):
            print('BAD TYPES %s: %r' % (mod_name, t))
            BAD += 1
            continue
        if pos not in POS:
            print('BAD POS %s line %d: %s' % (mod_name, ln, pos))
            BAD += 1
        if ln < 1 or ln > n:
            print('BAD LINE %s: %d (file has %d lines)' % (mod_name, ln, n))
            BAD += 1
        if (ln, pos) in seen:
            print('DUP ANCHOR %s: (%d,%s)' % (mod_name, ln, pos))
            BAD += 1
        seen.add((ln, pos))
        if '"' in text or '\\' in text:
            print('BAD CHAR %s line %d: 含英文双引号或反斜杠' % (mod_name, ln))
            BAD += 1
    print('OK %-48s %-45s 锚点 %d / 源 %d 行' % (mod_name, rel, len(anns), n))


for name, rel in EXPECTED:
    load(name, rel)

print('\n==== 预检结果：%s ====' % ('全部通过' if BAD == 0 else ('%d 处问题' % BAD)))
