# -*- coding: utf-8 -*-
# slug: src_utils_configConstants_ts  | source: src/utils/configConstants.ts
ANNOTATIONS = [
    (1, 'before', '''本文件集中放一批「全局配置常量」，刻意独立成文件且禁止引入任何依赖，以避免出现循环依赖。'''),
    (4, 'after', '''NOTIFICATION_CHANNELS 列出所有受支持的通知渠道：自动、iTerm2（含响铃变体）、终端响铃、kitty、ghostty，以及关闭通知。'''),
    (15, 'after', '''EDITOR_MODES 限定可用的编辑器模式：normal 与 vim；旧的 emacs 已被废弃并自动迁移到 normal，故不在此列出。'''),
    (21, 'after', '''TEAMMATE_MODES 限定可生成的队友模式：auto（按上下文自动选，默认）、tmux（传统基于 tmux 的队友）、in-process（同进程内队友）。'''),
]
