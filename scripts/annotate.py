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

自动纠正（模板字符串，本轮新增）：
    · 锚点落在「多行模板字符串内部」→ after 自动挪到闭合反引号之后，
      before 自动挪到开头反引号之前
为什么这条比块注释那条更严重：模板字符串里的反引号之间是**字符串内容**，
插进去的 `// 注：...` 不会变成注释，它会变成发给模型的提示词正文。
prompts.ts 一轮犯过 3 处（那个文件的函数体整体就是一个大模板字符串）。

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

# ── 正则字面量识别 ──
# 反引号也能出现在正则里：/^[)}`|&;(<>]/ 、/[a-zA-Z0-9\\${`-]/
# 不识别的话，扫到那个反引号就以为开了模板字符串，把后面几十行全判成
# 「模板内部」，然后把这些批注莫名其妙地外移（bashSecurity.ts 一轮 16 处）。
_REGEX_PREV = set('(,=:[!&|?{};+-*%~^<>')
_REGEX_KW = ('return', 'typeof', 'case', 'in', 'of', 'do', 'else')


def _regex_end(line, i):
    """若 line[i]=='/' 是正则字面量的开头，返回结束 '/' 的下标；否则 None。

    判据：`/` 前面是「期望表达式开始」的字符（= ( , : [ ! & | ? { } ; 运算符），
    或前面是 return/typeof/case 这类关键字。这是 JS 词法里区分
    「除号」和「正则开头」的标准做法（简化版）。
    """
    k = i - 1
    while k >= 0 and line[k].isspace():
        k -= 1
    prev = line[k] if k >= 0 else ''
    head = line[:i].rstrip()
    if prev and prev not in _REGEX_PREV and not head.endswith(_REGEX_KW):
        return None
    j = i + 1
    in_class = False
    while j < len(line):
        c = line[j]
        if c == '\\':
            j += 2
            continue
        if c == '[':
            in_class = True
        elif c == ']':
            in_class = False
        elif c == '/' and not in_class:
            return j
        j += 1
    return None


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

    def comment_run_start(lineno):
        """从 lineno 起，连续 // 行注释块的**第一行**。

        与 comment_run_end 配对使用：锚点落在注释段中部时，把中文挪到段边界，
        避免把一句英文从中间劈开。
        """
        i = lineno
        while i > 1 and lines[i - 2].strip().startswith('//'):
            i -= 1
        return i

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

    def template_spans():
        """找出所有「多行模板字符串」的 (起始行, 结束行)。

        为什么必须做这件事：模板字符串里反引号之间的内容是**字符串字面量**。
        往中间插一行 `// 注：xxx`，它不会被当成注释 —— 它会变成字符串的一部分，
        也就是直接写进了发给模型的系统提示词里。
        prompts.ts 里 getProactiveSection() 整个函数体就是一个 50 行的模板，
        getScratchpadInstructions() / computeEnvInfo() 的返回值也是，
        三处都踩了这个坑，而 check-fidelity.py 完全看不出来（代码行确实都在）。

        【v2：改成状态栈，修掉「${...} 里出现反引号」的误判】

        旧实现用一个 in_tpl 布尔量，遇到反引号就翻转。这在下面这种写法上会错：
          ${cond ? '...(with a `subagent_type`), ...' : ''}
        模板表达式里的**普通字符串**中出现反引号 —— 被当成模板闭合，
        于是后面的代码全被当成"模板内部"，锚点被错误外移。
        prompt.ts 第 260 行正是这种写法（一句英文里嵌了个参数名）。

        状态栈四种状态：
          code  普通代码
          tpl   模板字面量内部
          expr  模板的 ${...} 内部 —— 按代码规则扫，配对的 } 退栈
          block 块注释 /* */ 内部 —— 里面的反引号是文档字符，不是模板开启
        于是嵌套（模板套模板、表达式里的对象字面量）都被正确处理。

        block 这一层是被 bashSecurity.ts 第 472 行逼出来的：
          *   whitespace + `)` for the $(cat <<'EOF'...EOF)` inline form)
        不识别块注释，那个反引号会开启一个跨七十行的"模板"，
        把中间所有锚点当成"落在模板内部"而挪走。
        """
        spans = []
        stack = [['code', 0, 0]]
        for lineno, line in enumerate(lines, start=1):
            i = 0
            n = len(line)
            while i < n:
                cur = stack[-1]
                ch = line[i]

                if cur[0] == 'block':
                    if ch == '*' and i + 1 < n and line[i + 1] == '/':
                        stack.pop()
                        i += 2
                        continue
                    i += 1
                    continue

                if cur[0] == 'tpl':
                    if ch == '\\':
                        i += 2
                        continue
                    if ch == '`':
                        stack.pop()
                        spans.append((cur[1], lineno))
                        i += 1
                        continue
                    if ch == '$' and i + 1 < n and line[i + 1] == '{':
                        stack.append(['expr', lineno, 0])
                        i += 2
                        continue
                    i += 1
                    continue

                # code 或 expr —— 都按代码规则扫描
                if ch == '\\':
                    i += 2
                    continue
                if ch == '/' and i + 1 < n and line[i + 1] == '/':
                    break
                if ch == '/' and i + 1 < n and line[i + 1] == '*':
                    stack.append(['block', lineno, 0])
                    i += 2
                    continue
                if ch == '/':
                    re_end = _regex_end(line, i)
                    if re_end is not None:
                        i = re_end + 1
                        continue
                if ch in ('"', "'"):
                    q = ch
                    i += 1
                    while i < n and line[i] != q:
                        if line[i] == '\\':
                            i += 1
                        i += 1
                    i += 1
                    continue
                if ch == '`':
                    stack.append(['tpl', lineno, 0])
                    i += 1
                    continue
                if cur[0] == 'expr':
                    if ch == '{':
                        cur[2] += 1
                    elif ch == '}':
                        if cur[2] == 0:
                            stack.pop()
                        else:
                            cur[2] -= 1
                    i += 1
                    continue
                i += 1
        return spans

    spans = [s for s in template_spans() if s[1] > s[0]]  # 只看多行的

    def template_shift(lineno, pos):
        """锚点若落在多行模板内部，返回应该挪到的行号；否则 None。

        注意只对**严格内部**生效（不含起始行和结束行）：
          · 起始行是 `return \\`XXX`，在它后面插注释等于插在字符串开头 —— 也是错的，
            但它通常还有别的机会（before 起始行），所以这里也一并处理：
            after 落在起始行 → 挪到结束行之后
          · 结束行同理，after 落在结束行本来就是对的（字符串已闭合）
        """
        for s, e in spans:
            if s <= lineno < e:
                return e if pos == 'after' else s
        return None

    before = {}
    after = {}
    shifted = []
    snapped = []
    for lineno, pos, text in ann:
        if pos == 'after_block':
            lineno = comment_run_end(lineno)
            pos = 'after'
        # 结构性保护：`//` 注释也是成段的。锚点落在段中部时，中文会插进
        # 一段英文注释的中间，把一句话劈成两半（英文上半 → 中文 → 英文下半）。
        #
        # 这类破坏语法上完全合法、check-fidelity 也看不出来（注释一行没少），
        # 但读起来是断的：得把上下两截英文自己接起来才读得懂。
        # claude.ts 的 Options.taskBudget 四行注释就被劈过（提交 6b09281），
        # apiMicrocompact.ts / autoCompact.ts 也各劈过一次。
        #
        # 处理：after → 挪到整段末尾；before → 挪到整段开头。
        # 单行注释段（最常见的情况）两个方向都不产生位移。
        if pos in ('after', 'before') and lines[lineno - 1].strip().startswith('//'):
            tgt = comment_run_end(lineno) if pos == 'after' else comment_run_start(lineno)
            if tgt != lineno:
                snapped.append((lineno, tgt))
                lineno = tgt
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
        # 结构性保护（更硬）：模板字符串内部是字符串内容，不是注释区。
        tgt = template_shift(lineno, pos)
        if tgt is not None:
            shifted.append((lineno, tgt))
            lineno = tgt
        if lineno < 1 or lineno > len(lines):
            raise SystemExit('行号越界: %d（文件共 %d 行）' % (lineno, len(lines)))
        target = before if pos == 'before' else after
        target.setdefault(lineno, []).extend(render(text))

    if shifted:
        print('  ⟳ %d 个锚点原本落在模板字符串内部，已自动外移：%s'
              % (len(shifted), ', '.join('%d→%d' % (a, b) for a, b in shifted)))
        print('    （这些批注是「解释整段模板」的性质，外移后请确认位置是否仍然通顺）')

    if snapped:
        print('  ⟳ %d 个锚点原本落在 // 注释段中部，已挪到段边界（避免劈开英文句子）：%s'
              % (len(snapped), ', '.join('%d→%d' % (a, b) for a, b in snapped)))

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
