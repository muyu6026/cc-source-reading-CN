#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把落在「多行赋值开头行（以 = 结尾）」的 after 锚点，挪到该赋值的收尾行。"""
import os
import re

ANNOT_DIR = os.path.dirname(os.path.abspath(__file__))

RELOCS = {
    'src_utils_listSessionsImpl_ts_p1.py': [(97, 102), (115, 119), (123, 126), (127, 128)],
    'src_utils_betas_ts_p1.py': [(319, 320), (323, 325)],
    'src_utils_statsCache_ts_p1.py': [(342, 343)],
}


def main():
    for fname, relocs in RELOCS.items():
        path = os.path.join(ANNOT_DIR, fname)
        lines = open(path, encoding='utf-8').read().split('\n')
        by_old = {old: new for old, new in relocs}
        changed = 0
        for i, ln in enumerate(lines):
            m = re.match(r'^(\s*\()(\d+)(,\s*\'[a-z_]+\',\s*\'\'\')', ln)
            if not m:
                continue
            no = int(m.group(2))
            if no in by_old:
                new_no = by_old[no]
                lines[i] = m.group(1) + str(new_no) + m.group(3) + ln[m.end(3):]
                changed += 1
                print('  ✓ %s 行 %d → %d' % (fname, no, new_no))
        if changed:
            open(path, 'w', encoding='utf-8').write('\n'.join(lines))
        else:
            print('  (无改动) %s' % fname)
    print('重定位完成。')


if __name__ == '__main__':
    main()
