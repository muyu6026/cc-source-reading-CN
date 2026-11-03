# -*- coding: utf-8 -*-
# 预检脚本：第 111 批（components 四件）
# 断言：加载可执行 / 文本无英文双引号与反斜杠与控制字符 / 行号在范围内且非空 /
#       同文件无重复锚点 / 锚点行不落块注释或多行模板字符串内部 / 打印锚点行供核对
import importlib.util
import sys

ROOT = 'D:/CC泄露源码分析'

FILES = [
    ('source/src/components/permissions/BashPermissionRequest/BashPermissionRequest.tsx',
     'scripts/_annot/src_components_permissions_BashPermissionRequest_BashPermissionRequest_tsx_p1.py'),
    ('source/src/components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx',
     'scripts/_annot/src_components_permissions_AskUserQuestionPermissionRequest_QuestionView_tsx_p1.py'),
    ('source/src/components/grove/Grove.tsx',
     'scripts/_annot/src_components_grove_Grove_tsx_p1.py'),
    ('source/src/components/permissions/PermissionDecisionDebugInfo.tsx',
     'scripts/_annot/src_components_permissions_PermissionDecisionDebugInfo_tsx_p1.py'),
]


def load_module(path):
    spec = importlib.util.spec_from_file_location('data_' + str(abs(hash(path))), ROOT + '/' + path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def classify_lines(src_lines):
    n = len(src_lines)
    state = 'code'
    inside = [False] * (n + 1)
    for i, line in enumerate(src_lines, 1):
        inside[i] = state in ('block', 'template')
        j = 0
        L = len(line)
        while j < L:
            if state == 'code':
                if line.startswith('//', j):
                    break
                if line.startswith('/*', j):
                    state = 'block'
                    j += 2
                    continue
                if line[j] == '`':
                    state = 'template'
                    j += 1
                    continue
                if line[j] in ('"', "'"):
                    q = line[j]
                    j += 1
                    while j < L:
                        if line[j] == '\\\\':
                            j += 2
                            continue
                        if line[j] == q:
                            break
                        j += 1
                    j += 1
                    continue
                j += 1
            elif state == 'block':
                k = line.find('*/', j)
                if k == -1:
                    j = L
                else:
                    state = 'code'
                    j = k + 2
            else:
                if line[j] == '\\\\':
                    j += 2
                    continue
                if line[j] == '`':
                    state = 'code'
                    j += 1
                    continue
                j += 1
    return inside, state


fail = 0
total = 0
for src_rel, data_rel in FILES:
    src_lines = open(ROOT + '/' + src_rel, encoding='utf-8').read().splitlines()
    nlines = len(src_lines)
    inside, end_state = classify_lines(src_lines)
    assert end_state == 'code', src_rel + ': 结束状态非 code'
    mod = load_module(data_rel)
    anns = mod.ANNOTATIONS
    seen = set()
    print('===', src_rel, '源', nlines, '行，锚点', len(anns), '条')
    for ln, pos, text in anns:
        assert pos in ('before', 'after', 'after_block'), 'pos 非法'
        for ch in text:
            assert ch not in ('"', '\\\\'), data_rel + ' 行' + str(ln) + ': 禁用字符 ' + repr(ch)
            assert ord(ch) >= 32 or ch == '\t', data_rel + ' 行' + str(ln) + ': 控制字符 ' + repr(ch)
        assert 1 <= ln <= nlines, data_rel + ': 行号越界 ' + str(ln)
        stripped = src_lines[ln - 1].strip()
        assert stripped, data_rel + ': 锚点行为空 ' + str(ln)
        key = (ln, pos)
        assert key not in seen, data_rel + ': 重复锚点 ' + str(key)
        seen.add(key)
        if inside[ln]:
            is_edge = stripped.startswith('/*') or stripped.endswith('*/') or stripped.startswith('*')
            if not is_edge:
                print('  [BLOCK-INTERIOR] 行', ln, pos, repr(stripped[:60]))
                fail += 1
        total += 1
        print('  %5d %-6s %s' % (ln, pos, stripped[:86]))

print()
print('总锚点：', total, ' 块内部违例：', fail)
sys.exit(1 if fail else 0)
