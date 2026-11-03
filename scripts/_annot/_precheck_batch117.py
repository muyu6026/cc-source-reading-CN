# -*- coding: utf-8 -*-
# 预检脚本：第 117 批（components 15 件）
# 断言：slug 与源路径一一对应 / pos 合法 / 行号在范围内且非空 /
#       同文件无重复锚点 / 无英文双引号与反斜杠与控制字符 /
#       锚点不落块注释内部或多行模板字符串内部 / 打印锚点行供核对
import importlib.util
import sys

ROOT = 'D:/CC泄露源码分析'

FILES = [
    ('source/src/components/TrustDialog/TrustDialog.tsx',
     'scripts/_annot/src_components_TrustDialog_TrustDialog_tsx_p1.py'),
    ('source/src/components/CustomSelect/use-select-input.ts',
     'scripts/_annot/src_components_CustomSelect_use_select_input_ts_p1.py'),
    ('source/src/components/diff/DiffDetailView.tsx',
     'scripts/_annot/src_components_diff_DiffDetailView_tsx_p1.py'),
    ('source/src/components/CoordinatorAgentStatus.tsx',
     'scripts/_annot/src_components_CoordinatorAgentStatus_tsx_p1.py'),
    ('source/src/components/agents/agentFileUtils.ts',
     'scripts/_annot/src_components_agents_agentFileUtils_ts_p1.py'),
    ('source/src/components/Spinner/TeammateSpinnerTree.tsx',
     'scripts/_annot/src_components_Spinner_TeammateSpinnerTree_tsx_p1.py'),
    ('source/src/components/permissions/PermissionExplanation.tsx',
     'scripts/_annot/src_components_permissions_PermissionExplanation_tsx_p1.py'),
    ('source/src/components/ResumeTask.tsx',
     'scripts/_annot/src_components_ResumeTask_tsx_p1.py'),
    ('source/src/components/LogoV2/ChannelsNotice.tsx',
     'scripts/_annot/src_components_LogoV2_ChannelsNotice_tsx_p1.py'),
    ('source/src/components/tasks/InProcessTeammateDetailDialog.tsx',
     'scripts/_annot/src_components_tasks_InProcessTeammateDetailDialog_tsx_p1.py'),
    ('source/src/components/Spinner/SpinnerAnimationRow.tsx',
     'scripts/_annot/src_components_Spinner_SpinnerAnimationRow_tsx_p1.py'),
    ('source/src/components/EffortCallout.tsx',
     'scripts/_annot/src_components_EffortCallout_tsx_p1.py'),
    ('source/src/components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx',
     'scripts/_annot/src_components_permissions_WebFetchPermissionRequest_WebFetchPermissionRequest_tsx_p1.py'),
    ('source/src/components/tasks/DreamDetailDialog.tsx',
     'scripts/_annot/src_components_tasks_DreamDetailDialog_tsx_p1.py'),
    ('source/src/components/TrustDialog/utils.ts',
     'scripts/_annot/src_components_TrustDialog_utils_ts_p1.py'),
]


def load_module(path):
    spec = importlib.util.spec_from_file_location('data_' + str(abs(hash(path))), ROOT + '/' + path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def expected_slug(src_rel):
    return src_rel.replace('source/', '').replace('/', '_').replace('.', '_').replace('-', '_')


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
                        if line[j] == '\\':
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
                if line[j] == '\\':
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
    # slug 与源路径一一对应
    base = data_rel.split('/')[-1].replace('_p1.py', '')
    exp = expected_slug(src_rel)
    if base != exp:
        print('  [SLUG-MISMATCH] %s -> %s (期望 %s)' % (data_rel, base, exp))
        fail += 1
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
            assert ch not in ('"', '\\'), data_rel + ' 行' + str(ln) + ': 禁用字符 ' + repr(ch)
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
