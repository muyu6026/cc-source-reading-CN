#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按行号注入中文批注，生成 annotated/ 镜像文件。

为什么不用手写：手写整份文件意味着要把 2592 行源码重新敲一遍，
任何一处空格/引号差异都会破坏「批注版代码行必须与原文逐行相等」的约束。
本脚本从 source/ 逐行读取，只在指定位置插入注释行，代码行原样搬运，
保真度因此是结构性的，而不是靠人工校对。

批注数据放在 scripts/_annot/<slug>.py，格式：
    ANNOTATIONS = [
        (12, 'before', '''第一行
第二行'''),
        (16, 'after', '这一行是做什么的'),
    ]
位置表达：
    before        = 插在该行之前
    after         = 插在该行之后
    after_block   = 插在「该行所在的连续 // 注释块」之后（多行英文注释不会被中文劈开）

自动纠正（不需要手工算行号）：
    · after 落在 /** 开头行  → 自动挪到该块注释之后
    · before 落在 */ 结尾行  → 自动挪到该块注释之前
这两条是结构性的：中文插进块注释内部语法上合法，但会把英文文档注释劈成两半。
bashPermissions.ts 一轮就犯过 14 次，check-fidelity.py 现在把它列为硬判据。

用法：
    python scripts/annotate.py src/tools/BashTool/bashSecurity.ts
"""
import io
import os
import sys
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# 中文批注里可能出现这些「看起来像注释标记」的前缀，统一由脚本加 //
PREFIX = '// '


def load_annotations(rel_path):
    slug = rel_path.replace('/', '_').replace('.', '_').replace('-', '_')
    # 允许一个文件对应多份数据（按 _p1 / _p2 后缀分片），按名字排序拼接
    candidates = sorted(
        f for f in os.listdir(ANNOT_DIR)
        if f.startswith(slug + '_p') and f.endswith('.py')
    )
    items = []
    for name in candidates:
        path = os.path.join(ANNOT_DIR, name)
        spec = importlib.util.spec_from_file_location(name[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        items.extend(mod.ANNOTATIONS)
    if not candidates:
        raise SystemExit('找不到批注数据：%s_p*.py（在 scripts/_annot/ 下）' % slug)
    return items


def render(text):
    """把一段批注文本变成若干行 // 注释。

    两种写法都接受：
      · 不带前缀的「注：xxx」  → 自动加 `// `
      · 自带前缀的「// 注：xxx」→ 原样输出（多行块状注释里更易读）
    空行输出裸 `//`，用作分段留白。
    """
    out = []
    for line in text.split('\n'):
        line = line.rstrip()
        if line == '':
            out.append('//')
        elif line.startswith('//'):
            out.append(line)
        else:
            out.append(PREFIX + line)
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit('用法: python scripts/annotate.py <source 下的相对路径>')
    rel = sys.argv[1].replace('\\', '/')

    src = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(src):
        raise SystemExit('源文件不存在: %s' % src)

    lines = io.open(src, encoding='utf-8', newline='').read().split('\n')
    # 末行为空字符串时（文件以 \n 结尾）保留，写回时用 join 还原

    ann = load_annotations(rel)

    def comment_run_end(lineno):
        """从 lineno 起，连续 // 行注释块的最后一行。

        为什么需要它：一段英文注释常常是 5-8 行连续 //，如果在第 1 行后面插中文，
        剩下的英文就被推到中文下面去了，「英文在上、中文在下」的对照关系会断掉。
        after_block 把锚点自动挪到整段注释之后。
        """
        i = lineno
        while i <= len(lines) and lines[i - 1].strip().startswith('//'):
            i += 1
        return i - 1

    def block_end(lineno):
        """若 lineno 是块注释的开头行，返回该块的结束行；否则返回 None。"""
        s = lines[lineno - 1].strip()
        if not s.startswith('/*') or s.endswith('*/'):
            return None
        for i in range(lineno + 1, len(lines) + 1):
            if lines[i - 1].strip().endswith('*/'):
                return i
        return None

    def block_start(lineno):
        """若 lineno 是块注释的结尾行，返回该块的开头行；否则返回 None。"""
        s = lines[lineno - 1].strip()
        if not s.endswith('*/'):
            return None
        for i in range(lineno - 1, 0, -1):
            t = lines[i - 1].strip()
            if t.startswith('/*'):
                return i if i != lineno else None
            if t.endswith('*/'):
                return None
        return None

    before = {}
    after = {}
    for lineno, pos, text in ann:
        if pos == 'after_block':
            lineno = comment_run_end(lineno)
            pos = 'after'
        # 结构性保护：锚点落在块注释的开头行/结尾行时自动挪到块外，
        # 否则中文会被塞进 /** */ 中间，把英文文档注释劈成两半。
        if pos == 'after':
            end = block_end(lineno)
            if end is not None:
                lineno = end
        elif pos == 'before':
            start = block_start(lineno)
            if start is not None:
                lineno = start
        if lineno < 1 or lineno > len(lines):
            raise SystemExit('行号越界: %d（文件共 %d 行）' % (lineno, len(lines)))
        target = before if pos == 'before' else after
        target.setdefault(lineno, []).extend(render(text))

    # 警告：锚点落在 /* */ 块注释内部时，中文批注会被吞进块注释，
    # 把英文块注释劈成两半，可读性很差（语法上仍合法）。
    # 判定要点：只看「以 /* 开头」的行来开启块注释。早期版本用 `'/*' in s`，
    # 结果被行注释里的 `Read(<dir>/**)` 骗到 —— 那个 / ** 既没有闭合的 */，
    # 又让后面几十行全部被误判成块内（bashPermissions.ts 一轮误报 14 处）。
    in_block = []
    open_at = None
    for i, line in enumerate(lines, start=1):
        s = line.strip()
        if open_at is None:
            if s.startswith('/*') and not s.endswith('*/'):
                open_at = i
        elif s.endswith('*/') or (s.startswith('/*') and s.endswith('*/')):
            open_at = None
        if open_at is not None and open_at != i:
            in_block.append(i)
    bad_spots = sorted(set(before) | set(after))
    inside = [n for n in bad_spots if n in set(in_block)]
    if inside:
        print('  ⚠ %d 个锚点落在块注释内（建议移到注释块之后）：%s'
              % (len(inside), ', '.join(map(str, inside))))

    out = []
    for i, line in enumerate(lines, start=1):
        out.extend(before.get(i, []))
        out.append(line)
        out.extend(after.get(i, []))

    dst = os.path.join(ROOT, 'annotated', rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    io.open(dst, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))

    code_lines = len(lines)
    ann_lines = len(out) - code_lines
    print('写入 %s' % dst)
    print('  原文 %d 行 → 批注版 %d 行（插入注释 %d 行，%d 处锚点）'
          % (code_lines, len(out), ann_lines, len(ann)))


if __name__ == '__main__':
    main()
