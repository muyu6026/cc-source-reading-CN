# -*- coding: utf-8 -*-
import ast
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_ROOT = os.path.join(ROOT, 'source')
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

FILES = [
    'src/components/VirtualMessageList.tsx',
    'src/components/ScrollKeybindingHandler.tsx',
    'src/components/tasks/RemoteSessionDetailDialog.tsx',
]


def slug_of(rel):
    s = rel
    for ch in '/.-':
        s = s.replace(ch, '_')
    return s


def block_kinds(lines):
    """返回 行号 -> code/open/openclose/interior/close 的分类。"""
    info = {}
    in_block = False
    for i, ln in enumerate(lines, 1):
        kind = 'code'
        s = ln
        if in_block:
            if '*/' in s:
                rest = s.split('*/', 1)[1]
                kind = 'close'
                in_block = False
                if '/*' in rest:
                    tail = rest.split('/*', 1)[1]
                    if '*/' not in tail:
                        in_block = True
                        kind = 'close_open'
            else:
                kind = 'interior'
        else:
            if '/*' in s:
                after = s.split('/*', 1)[1]
                if '*/' in after:
                    kind = 'openclose'
                else:
                    kind = 'open'
                    in_block = True
        info[i] = kind
    return info


def main():
    fails = 0
    total = 0
    for rel in FILES:
        base = slug_of(rel) + '_p1'
        path = os.path.join(ANNOT_DIR, base + '.py')
        if not os.path.exists(path):
            print('FAIL %s: 数据文件缺失 %s' % (rel, base + '.py'))
            fails += 1
            continue

        with open(path, encoding='utf-8') as f:
            code = f.read()
        try:
            ast.parse(code)
        except SyntaxError as e:
            print('FAIL %s: 数据文件 ast.parse 失败 %s' % (rel, e))
            fails += 1
            continue

        spec = importlib.util.spec_from_file_location('m_' + base, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        anns = getattr(mod, 'ANNOTATIONS', None)
        if anns is None:
            print('FAIL %s: 缺 ANNOTATIONS' % rel)
            fails += 1
            continue

        src_path = os.path.join(SRC_ROOT, rel)
        with open(src_path, encoding='utf-8') as f:
            raw = f.read()
        lines = raw.split('\n')
        nlines = len(lines)
        kinds = block_kinds(lines)

        seen = set()
        for item in anns:
            total += 1
            if len(item) != 3:
                print('FAIL %s: 元组长度不是 3 -> %r' % (rel, item))
                fails += 1
                continue
            ln, pos, text = item
            if pos not in ('before', 'after', 'after_block'):
                print('FAIL %s: 非法 pos %r @%s' % (rel, pos, ln))
                fails += 1
            if not isinstance(ln, int) or ln < 1 or ln > nlines:
                print('FAIL %s: 行号越界 %r (源 %d 行)' % (rel, ln, nlines))
                fails += 1
                continue
            key = (ln, pos)
            if key in seen:
                print('FAIL %s: 重复锚点 %r' % (rel, key))
                fails += 1
            seen.add(key)
            if '"' in text:
                print('FAIL %s: 文本含英文双引号 @%s' % (rel, ln))
                fails += 1
            if '\\' in text:
                print('FAIL %s: 文本含反斜杠 @%s' % (rel, ln))
                fails += 1
            k = kinds.get(ln, 'code')
            if k == 'interior':
                print('FAIL %s: 锚点落在块注释内部 @%s (%s)' % (rel, ln, pos))
                fails += 1
            if k in ('close', 'close_open') and pos == 'after':
                print('FAIL %s: after 落在块注释收尾行 @%s' % (rel, ln))
                fails += 1

        print('OK  %-55s %2d 锚点 / 源 %d 行' % (rel, len(anns), nlines))

    print('---- 合计 %d 锚点，%d 个问题 ----' % (total, fails))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
