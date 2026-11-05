# -*- coding: utf-8 -*-
# 批注数据：src/vim/types.ts
# 锚点 (行号, pos, 中文)。pos ∈ before/after/after_block。
ANNOTATIONS = [
    (31, 'after', '模块：vim 模式状态机的类型定义。类型本身即文档——读懂这些联合类型就理解了整个输入处理流程。'),
    (33, 'after', '`Operator`：删除、修改、复制三种操作符。'),
    (35, 'after', '`FindType`：f / F / t / T 四种查找方向。'),
    (37, 'after', '`TextObjScope`：inner（内侧）与 around（环绕）两种文本对象范围。'),
    (49, 'before', '`VimState`：完整状态，按模式区分——插入模式记录已输入文本，普通模式记录命令状态机。'),
    (59, 'before', '`CommandState`：普通模式的命令状态机，每种状态明确知道自己在等哪种输入；TypeScript 保证 `switch` 穷尽处理。'),
    (81, 'before', '`PersistentState`：跨命令持久的状态，即 vim 的「记忆」——用于点重复与粘贴。'),
    (92, 'before', '`RecordedChange`：为点重复录制的变更，捕获重放所需的一切信息。'),
    (125, 'after', '`OPERATORS`：操作符的命名常量表，避免散落魔法字符串。'),
    (135, 'after', '`SIMPLE_MOTIONS`：基础移动集合（左右上下、词、行首尾等）。'),
    (182, 'after', '`MAX_VIM_COUNT`：计数上限，防止异常大的重复次数。'),
    (188, 'before', '`createInitialVimState`：初始进入插入模式、无已输入文本。'),
    (192, 'before', '`createInitialPersistentState`：初始无录制、无上次查找、寄存器为空。'),
]
