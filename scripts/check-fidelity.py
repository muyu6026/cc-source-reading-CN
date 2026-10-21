#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
批注保真校验：确认 annotated/ 里的文件没有改动 source/ 的任何一行原文。

判据（两条硬规则 + 一条软检查）：
  1. 【硬】annotated 的「代码行」序列，必须与 source 的「代码行」序列**逐行完全相等**
     → 证明没有增删代码、没有改代码、没有漏掉闭括号
  2. 【硬】source 的每一行注释（含块注释），都必须能在 annotated 的
     非批注注释行中按原顺序找到
     → 证明英文原文一个字没删、没改写
  3. 【软】annotated 多出来的注释行必须是 `// 译：` / `// 注：` / `// ─` / `// ═`
     或文件头部的说明块（仅作统计，不判失败）

用法：
  python scripts/check-fidelity.py              # 校验全部
  python scripts/check-fidelity.py src/commands/clear/index.ts   # 只校验一个
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'source')
ANN = os.path.join(ROOT, 'annotated')

# annotated/ 里不是「源码镜像」的文件，跳过（.md 后缀的镜像本身就不参与逐行比对）
SKIP_NAMES = {'README.annotated.md', 'package.json.annotated.md'}

# 已知的、有意省略的原文行：文件相对路径 → 说明
KNOWN_OMIT = {
    'src/entrypoints/cli.tsx':
        '末尾 sourceMappingURL 单行 27,448 字符的 base64 sourcemap，批注版改为一句话说明',
    'src/tools/BashTool/BashTool.tsx':
        '末尾 sourceMappingURL 单行约 8 万字符的 base64 sourcemap，批注版改为一句话说明',
}

ANN_PREFIXES = ('// 译：', '// 注：', '// ─', '// ═')

# 批注常写成「// ═══ 标题 ═══ + 若干缩进续行」的块，续行没有固定前缀。
# 判据：批注侧含中日韩字符的注释行都算批注（原文代码里的注释是纯英文）。
# 只对 annotated 侧启用，避免原文里万一有中文注释时被判成批注而漏检。
_CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]')


def read_lines(path):
    with open(path, 'r', encoding='utf-8') as f:
        return [ln.rstrip('\n').rstrip() for ln in f]


def classify(line, cjk_as_annotation=False):
    """把一个非空行分成 code / comment / annotation"""
    s = line.strip()
    if s.startswith(ANN_PREFIXES):
        return 'annotation'
    if s.startswith('//') or s.startswith('/*') or s.startswith('*'):
        if cjk_as_annotation and _CJK.search(s):
            return 'annotation'
        return 'comment'
    # 行尾注释也算代码行（行尾注释的变化会在注释检查里被抓到）
    return 'code'


def split(lines, cjk_as_annotation=False):
    code, comment, annotation = [], [], []
    in_fence = False
    for ln in lines:
        s = ln.strip()
        if s.startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence or not s:
            continue
        kind = classify(ln, cjk_as_annotation)
        {'code': code, 'comment': comment, 'annotation': annotation}[kind].append(s)
    return code, comment, annotation


def check_block_purity(lines):
    """判据 3：块注释内部不许出现中文。

    劈开英文文档注释是批注过程中最容易犯、又最难自己发现的错：
    在 `/**` 的某一行后面插一段 `// 译：…`，语法上完全合法（块注释里的 // 只是字符），
    但英文注释被中文从中间截断了，可读性彻底坏掉。
    bashPermissions.ts 一轮就出现 14 处，所以这里把它做成硬判据。
    返回违规行号列表（1 基）。
    """
    bad = []
    open_at = None
    for i, ln in enumerate(lines, start=1):
        s = ln.strip()
        if open_at is None:
            if s.startswith('/*') and not s.endswith('*/'):
                open_at = i
            continue
        if s.endswith('*/'):
            open_at = None
            continue
        if _CJK.search(s) and not s.startswith('*'):
            bad.append(i)
    return bad


def check_one(rel):
    src_path = os.path.join(SRC, rel.replace('/', os.sep))
    ann_path = os.path.join(ANN, rel.replace('/', os.sep))
    if not os.path.exists(src_path):
        return 'MISSING_SRC', rel, 'source 里没有这个文件'
    if not os.path.exists(ann_path):
        return 'MISSING_ANN', rel, '还没有批注版'

    ann_lines = read_lines(ann_path)
    impure = check_block_purity(ann_lines)
    if impure:
        return 'FAIL', rel, (
            '有中文插进了 /* */ 块注释内部，英文注释被劈开，行号: %s'
            % ', '.join(map(str, impure[:10])))

    src_code, src_comment, _ = split(read_lines(src_path))
    ann_code, ann_comment, ann_note = split(ann_lines, cjk_as_annotation=True)

    # ── 判据 1：代码行逐行相等 ──
    if ann_code != src_code:
        detail = []
        n = min(len(ann_code), len(src_code))
        for i in range(n):
            if ann_code[i] != src_code[i]:
                detail.append('第 %d 个代码行不一致:\n  原文: %s\n  批注: %s'
                              % (i + 1, src_code[i], ann_code[i]))
                break
        if not detail:
            if len(ann_code) < len(src_code):
                detail.append('批注版少了 %d 行代码，从原文这行开始缺: %s'
                              % (len(src_code) - len(ann_code), src_code[len(ann_code)]))
            else:
                detail.append('批注版多了 %d 行代码，从这行开始: %s'
                              % (len(ann_code) - len(src_code), ann_code[len(src_code)]))
        return 'FAIL', rel, '\n        '.join(detail)

    # ── 判据 2：原文注释按顺序全部保留 ──
    i, missing = 0, []
    for c in src_comment:
        hit = -1
        for j in range(i, len(ann_comment)):
            if ann_comment[j] == c:
                hit = j
                break
        if hit < 0:
            missing.append(c)
        else:
            i = hit + 1
    if missing:
        msg = '原文注释丢失/被改写 %d 行：\n        ' % len(missing)
        msg += '\n        '.join(m[:90] for m in missing[:6])
        if rel in KNOWN_OMIT:
            return 'WARN', rel, msg + '\n        （已知例外：%s）' % KNOWN_OMIT[rel]
        return 'FAIL', rel, msg

    return 'OK', rel, ''


def collect():
    out = []
    for base, _, files in os.walk(ANN):
        for fn in sorted(files):
            if fn in SKIP_NAMES or fn.endswith('.md'):
                continue
            full = os.path.join(base, fn)
            out.append(os.path.relpath(full, ANN).replace(os.sep, '/'))
    return sorted(out)


def main():
    targets = [t.replace('\\', '/') for t in sys.argv[1:]] or collect()
    bad = 0
    for rel in targets:
        status, name, info = check_one(rel)
        if status == 'OK':
            src_code, src_comment, _ = split(read_lines(os.path.join(SRC, rel)))
            ann_code, ann_comment, ann_note = split(read_lines(os.path.join(ANN, rel)), cjk_as_annotation=True)
            print('  OK    %-44s 代码 %3d 行一致 · 注释 %3d 行全保留 · 中文批注 %3d 行'
                  % (name, len(src_code), len(src_comment), len(ann_note)))
        elif status == 'WARN':
            print('  WARN  %s\n        %s' % (name, info))
        else:
            bad += 1
            print('  %s  %s\n        %s' % (status, name, info))
    print('\n%d 个文件校验，%d 个失败' % (len(targets), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
