#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复预检发现的非法字符（双引号 / 反斜杠）锚点文本。"""
import os
import re

ANNOT_DIR = os.path.dirname(os.path.abspath(__file__))

# 文件名 -> [(锚点行号, 修正后文本), ...]
FIXES = {
    'src_utils_listSessionsImpl_ts_p1.py': [
        (132, '标签提取只认 type=tag 的那一行 JSON，避免和工具入参里同样叫 `tag` 的字段（git tag、Docker 标签、云资源标签）撞名。'),
    ],
    'src_utils_imagePaste_ts_p1.py': [
        (38, '临时目录取 `CLAUDE_CODE_TMPDIR`，未设则按平台回退（Windows 用 `TEMP` 或 `C:/Temp`，其他用 `/tmp`）。'),
    ],
    'src_utils_claudeInChrome_setup_ts_p1.py': [
        (180, 'Windows 把清单装到 `AppData/Claude Code/ChromeNativeHost`，路径由注册表项指向。'),
    ],
    'src_utils_plugins_pluginOptionsStorage_ts_p1.py': [
        (250, '用 startsWith 做「以 pluginId 加斜杠为前缀」的匹配：插件 ID 形如 name@marketplace 不含斜杠，不会误伤别的插件。'),
        (326, '`substitutePluginVariables`：把 `${CLAUDE_PLUGIN_ROOT}`（版本作用域安装目录）与 `${CLAUDE_PLUGIN_DATA}`（持久状态目录）替换成真实路径；Windows 上把反斜杠归一为正斜杠，避免 shell 把反斜杠当成转义字符。'),
    ],
}

LINE_RE = re.compile(r"^(\s*\(\d+,\s*'(?:before|after|after_block)',\s*''')")


def main():
    for fname, fixes in FIXES.items():
        path = os.path.join(ANNOT_DIR, fname)
        lines = open(path, encoding='utf-8').read().split('\n')
        by_no = {no: txt for no, txt in fixes}
        changed = 0
        for i, ln in enumerate(lines):
            m = LINE_RE.match(ln)
            if not m:
                continue
            no = int(re.match(r'\s*\(\s*(\d+)', ln).group(1))
            if no in by_no:
                # 找到末尾的 ''')，保留前缀与后缀，替换中间文本
                prefix = m.group(1)
                idx = ln.rfind("'''),")
                if idx == -1:
                    print('  !! 无法定位 %s 行 %d 的结尾' % (fname, no))
                    continue
                suffix = ln[idx:]
                assert suffix == "'''),", '后缀不符: %r' % suffix
                new_text = by_no[no]
                assert '"' not in new_text and '\\' not in new_text, '修正文本仍含非法字符: %r' % new_text
                lines[i] = prefix + new_text + suffix
                changed += 1
                print('  ✓ %s 行 %d 已修正' % (fname, no))
        if changed:
            open(path, 'w', encoding='utf-8').write('\n'.join(lines))
        else:
            print('  (无改动) %s' % fname)
    print('修复完成。')


if __name__ == '__main__':
    main()
