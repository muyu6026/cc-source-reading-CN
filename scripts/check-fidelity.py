#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
批注保真校验：确认 annotated/ 里的文件没有改动 source/ 的任何一行原文。

判据（四条硬规则 + 一条软检查）：
  1. 【硬】annotated 的「代码行」序列，必须与 source 的「代码行」序列**逐行完全相等**
     → 证明没有增删代码、没有改代码、没有漏掉闭括号
  2. 【硬】source 的每一行注释（含块注释），都必须能在 annotated 的
     非批注注释行中按原顺序找到
     → 证明英文原文一个字没删、没改写
  3. 【硬】块注释 /* */ 内部不许出现中文
     → 否则英文文档注释被中文从中间劈开
  4. 【硬】多行模板字符串内部不许出现中文注释
     → 反引号之间是**字符串字面量**，插进去的 `// 注：` 不是注释，
       它会变成发给模型的提示词正文。比判据 3 严重一个量级：
       判据 3 只是难看，判据 4 是代码行为被改变。
  5. 【硬】中文批注不得插在「未结束的多行表达式」中间
     → 前一行以 `=`/`&&`/`?`/`:` 等结尾、或括号未配平时，插注释虽然
       语法合法，但会把一条语句拆成两半，读起来完全断掉。
  6. 【软】annotated 多出来的注释行必须是 `// 译：` / `// 注：` / `// ─` / `// ═`
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
    'src/ink/ink.tsx':
        '末尾 sourceMappingURL 单行约 10 万字符的 base64 sourcemap，批注版改为一句话说明',
}

ANN_PREFIXES = ('// 译：', '// 注：', '// ─', '// ═')

# 批注常写成「// ═══ 标题 ═══ + 若干缩进续行」的块，续行没有固定前缀。
# 判据：批注侧以中日韩字符为主的注释行算批注（原文代码里的注释是纯英文）。
# 只对 annotated 侧启用，避免原文里万一有中文注释时被判成批注而漏检。
_CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]')
_NONSPACE = re.compile(r'\S')

# 「以中日韩字符为主」而不是「含有中日韩字符」。
# 起因：screen.ts 原文有一行英文注释举例用了汉字
#   // Scenario: [a, 💻, spacer] → [本, spacer, ORPHAN spacer] when
# 旧的「含有即算批注」把它归到批注侧，于是判据 2 报原文注释丢失 —— 误报。
# 中文行里中文占比通常 30%-80%，而英文行夹一两个汉字不到 5%，
# 用 0.15 这个门限两边都分得开。
_CJK_RATIO = 0.15


def _mostly_cjk(s):
    total = len(_NONSPACE.findall(s))
    if total == 0:
        return False
    return len(_CJK.findall(s)) / total >= _CJK_RATIO


def read_lines(path):
    with open(path, 'r', encoding='utf-8') as f:
        return [ln.rstrip('\n').rstrip() for ln in f]


def classify(line, cjk_as_annotation=False):
    """把一个非空行分成 code / comment / annotation"""
    s = line.strip()
    if s.startswith(ANN_PREFIXES):
        return 'annotation'
    if s.startswith('//') or s.startswith('/*') or s.startswith('*'):
        if cjk_as_annotation and _mostly_cjk(s):
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


# 正则字面量里可以出现反引号（例：/^[)}`|&;(<>]/ 或 /[a-zA-Z0-9\\${`-]/）。
# 不识别它的话，扫描到那个反引号就会误以为开启了模板字符串，
# 于是把这个函数后面几十行全判成「模板内部」。bashSecurity.ts 一轮误报 3 处。
_REGEX_PREV = set('(,=:[!&|?{};+-*%~^<>')
_REGEX_KW = ('return', 'typeof', 'case', 'in', 'of', 'do', 'else')


def _regex_end(line, i):
    """若 line[i]=='/' 是正则字面量的开头，返回结束 '/' 的下标；否则 None。"""
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


def scan_template_spans(lines):
    """带状态栈的模板字符串扫描，返回 [(起始行, 结束行), ...]（含单行模板）。

    【为什么不能用单个布尔量 in_tpl】
    最初的实现只有一个 in_tpl 开关：遇到反引号就翻转。这在
    `${cond ? 'a `b` c' : ''}` 这种写法上会错得很离谱 ——
    模板表达式里的**普通字符串**中出现反引号，被误判成模板闭合，
    于是后面的代码被当成"模板内部"，整段误报。

    prompt.ts 第 260 行正是这种写法：
      ${forkEnabled ? '...(with a `subagent_type`), ...' : ''}
    它让模板在第 260 行被"提前关闭"，于是 272-286 行的中文批注
    被误判为"插在模板内部"。误报 == 真报警没有区别：一报警就要停下查。

    【正确做法：状态栈】
    栈里每层是 [状态, 起始行, 花括号深度]，状态四种：
      code  普通代码
      tpl   模板字符串字面量内部
      expr  模板的 ${...} 表达式内部 —— 它按**代码**规则扫描，
            但遇到配对的 } 要退栈
      block 块注释 /* */ 内部 —— 里面的反引号是**文档里的字符**，
            不是模板开启

    【block 这一层是被真实文件逼出来的】
    bashSecurity.ts 第 472 行是一条块注释续行：
      *   whitespace + `)` for the $(cat <<'EOF'...EOF)` inline form)
    不识别块注释的话，那个反引号会开启一个"模板"，一直延续到
    seventy 行之后的另一个反引号才闭合 —— 中间所有中文批注全被误报。
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


def check_template_purity(lines):
    """判据 4：多行模板字符串内部不许有中文注释行。

    为什么这条比块注释那条更严重：块注释里插入中文只是排版难看，代码行为不变。
    模板字符串里插入 `// 注：xxx`，它不是注释 —— 它是字符串内容，
    会跟着返回值一起发给 API，变成模型实际读到的系统提示词。
    prompts.ts 一轮出现 3 处（getProactiveSection / computeEnvInfo /
    getScratchpadInstructions 的返回值都是多行模板），
    而判据 1（代码行相等）对此完全无感：代码行确实一行没动。
    """
    inside = set()
    for s, e in scan_template_spans(lines):
        if e > s:  # 只看多行模板
            for k in range(s + 1, e + 1):  # 起始行的反引号之后才算内部
                inside.add(k)
    if not inside:
        return []
    return [ln for ln in sorted(inside)
            if ln <= len(lines)
            and lines[ln - 1].strip().startswith('//')
            and _CJK.search(lines[ln - 1])]


# 「表达式明显未结束」的行尾特征：赋值号、三元问号。
# 刻意**不包含**这四种，它们后面插注释都是正当写法：
#   · `,`   → 对象/数组字面量的元素之间，插注释说明该元素完全正常
#   · `:`   → `case 'x':` 后面插注释也正常
#   · `(`   → `function foo(` 后面写参数说明是常见写法
#   · `&&`  → 逐条解释 if 条件链里的每个条件，是最易读的写法之一
#     （setup.ts 的 root 校验就是这么写的：每个 `&&` 下面一句说明）
# 前三种试过，会让每条属性都误报（9 个文件全部失败）。
# `&&` 是权衡后放弃的：它误伤的那类批注质量比它抓到的那类高。
_OPEN_TAIL = re.compile(r'(=|\?)\s*$')


def check_split_expression(lines):
    """判据 5：中文批注不得插在未结束的多行表达式中间。

    典型现场（prompts.ts 一轮全中）：
        const [a, b, c] = await Promise.all([
        // 注：三件事并行拉……
          getSkillToolCommands(cwd),
    语法完全合法（注释在括号里没影响），但语句被劈成两半，
    读者看到的是「赋值语句突然断开」，完全失去上下文。
    """
    bad = []
    for i, ln in enumerate(lines):
        if not (ln.lstrip().startswith('//') and _CJK.search(ln)):
            continue
        if i == 0:
            continue
        prev = lines[i - 1]
        if prev.lstrip().startswith('//'):
            continue          # 同一批注块的续行，跳过
        code = prev.strip()
        if not code or code.startswith(('*', '/*')):
            continue
        if _OPEN_TAIL.search(code):
            bad.append((i + 1, code[:60]))
    return bad


def check_control_chars(lines):
    """批注里不该出现控制字符。

    起因：批注数据是 Python 三引号字符串，正文里写字面的 `\\n` `\\r` `\\0`
    `\\x1b` 会被 Python 转义成真字符。前两类会让一行批注裂成多行，
    后两类更糟——NUL 让 grep 把整个文件当二进制，ESC 直接把转义序列
    写进了源文件（编辑器/终端渲染时会真的生效）。

    规则：除制表符外，任何 < 0x20 的字符都算失败。
    """
    bad = []
    for i, ln in enumerate(lines, start=1):
        for ch in ln:
            if ch != '\t' and ord(ch) < 0x20:
                bad.append((i, ord(ch)))
                break
    return bad


def check_one(rel):
    src_path = os.path.join(SRC, rel.replace('/', os.sep))
    ann_path = os.path.join(ANN, rel.replace('/', os.sep))
    if not os.path.exists(src_path):
        return 'MISSING_SRC', rel, 'source 里没有这个文件'
    if not os.path.exists(ann_path):
        return 'MISSING_ANN', rel, '还没有批注版'

    ann_lines = read_lines(ann_path)
    bad_chars = check_control_chars(ann_lines)
    if bad_chars:
        return 'FAIL', rel, (
            '批注版里出现控制字符（多半是 Python 字符串转义泄漏，字面量要双写反斜杠）：%s'
            % ', '.join('第 %d 行 U+%04X' % (n, c) for n, c in bad_chars[:8]))

    impure = check_block_purity(ann_lines)
    if impure:
        return 'FAIL', rel, (
            '有中文插进了 /* */ 块注释内部，英文注释被劈开，行号: %s'
            % ', '.join(map(str, impure[:10])))

    in_tpl = check_template_purity(ann_lines)
    if in_tpl:
        return 'FAIL', rel, (
            '有中文注释插进了多行模板字符串内部 —— 它会变成字符串内容（即发给模型的提示词正文），行号: %s'
            % ', '.join(map(str, in_tpl[:10])))

    split_expr = check_split_expression(ann_lines)
    if split_expr:
        return 'FAIL', rel, (
            '中文批注插在了未结束的多行表达式中间，语句被劈开：\n        '
            + '\n        '.join('第 %d 行前：%s' % (n, c) for n, c in split_expr[:6]))

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
