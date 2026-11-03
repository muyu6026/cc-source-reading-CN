# -*- coding: utf-8 -*-
# 预检脚本：第 108 批（components 四件）
# 断言：
#  1 数据文件可执行加载且形状正确
#  2 批注文本无英文双引号、无反斜杠、无控制字符
#  3 行号在文件范围内且目标行非空
#  4 同文件内无重复锚点
#  5 锚点行不落在块注释或多行模板字符串内部（豁免块注释首尾行）
#  6 打印每条锚点行的 strip 内容供人工核对
import importlib.util
import sys

ROOT = 'D:/CC泄露源码分析'

FILES = [
    ('source/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx',
     'scripts/_annot/src_components_permissions_AskUserQuestionPermissionRequest_AskUserQuestionPermissionRequest_tsx_p1.py'),
    ('source/src/components/FullscreenLayout.tsx',
     'scripts/_annot/src_components_FullscreenLayout_tsx_p1.py'),
    ('source/src/components/ConsoleOAuthFlow.tsx',
     'scripts/_annot/src_components_ConsoleOAuthFlow_tsx_p1.py'),
    ('source/src/components/Feedback.tsx',
     'scripts/_annot/src_components_Feedback_tsx_p1.py'),
]


def load_module(path):
    spec = importlib.util.spec_from_file_location('data_' + str(abs(hash(path))), ROOT + '/' + path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def classify_lines(src_lines):
    '''返回每行是否处于块注释或模板字符串内部（首尾行豁免由调用方处理）。'''
    n = len(src_lines)
    state = 'code'  # code | block | template
    inside = [False] * (n + 1)
    for i, line in enumerate(src_lines, 1):
        inside[i] = state in ('block', 'template')
        j = 0
        L = len(line)
        while j < L:
            if state == 'code':
                # 行注释不跨行
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
            else:  # template
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
total_anchors = 0
for src_rel, data_rel in FILES:
    src_path = ROOT + '/' + src_rel
    src_lines = open(src_path, encoding='utf-8').read().splitlines()
    nlines = len(src_lines)
    inside, end_state = classify_lines(src_lines)
    assert end_state == 'code', src_rel + ': 结束状态非 code：' + end_state

    mod = load_module(data_rel)
    anns = mod.ANNOTATIONS
    assert isinstance(anns, list), data_rel + ': ANNOTATIONS 不是列表'
    seen = set()
    print('===', src_rel, '源', nlines, '行，锚点', len(anns), '条')
    for item in anns:
        assert isinstance(item, tuple) and len(item) == 3, data_rel + ': 形状错误 ' + repr(item)[:80]
        ln, pos, text = item
        assert pos in ('before', 'after', 'after_block'), data_rel + ': pos 非法 ' + str(pos)
        # 断言 2：无英文双引号、反斜杠、控制字符
        for ch in text:
            assert ch not in ('"', '\\\\'), data_rel + ' 行' + str(ln) + ': 文本含禁用字符 ' + repr(ch)
            assert ord(ch) >= 32 or ch in '\t', data_rel + ' 行' + str(ln) + ': 文本含控制字符 ' + repr(ch)
        # 断言 3：行号范围 + 非空行
        assert 1 <= ln <= nlines, data_rel + ': 行号越界 ' + str(ln)
        stripped = src_lines[ln - 1].strip()
        assert stripped, data_rel + ': 锚点行是空行 ' + str(ln)
        # 断言 4：重复锚点
        key = (ln, pos)
        assert key not in seen, data_rel + ': 重复锚点 ' + str(key)
        seen.add(key)
        # 断言 5：块注释/模板内部检测（块注释首尾行豁免）
        if inside[ln]:
            # 是否块注释首行或尾行
            is_block_edge = stripped.startswith('/*') or stripped.endswith('*/') or stripped.startswith('*')
            if not (is_block_edge and (ln, pos) != (1, 'after')):
                print('  [BLOCK-INTERIOR] 行', ln, pos, repr(stripped[:60]))
                fail += 1
        total_anchors += 1
        print('  %5d %-6s %s' % (ln, pos, stripped[:88]))

print()
print('总锚点：', total_anchors, ' 块内部违例：', fail)
sys.exit(1 if fail else 0)
