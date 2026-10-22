ANNOTATIONS = [
    (24, 'before',
     "`userFacingName` 决定了 TUI 里工具调用的动词：规划目录里的文件是 **`Updated plan`**、`old_string === ''` 是 **`Create`**、其余是 **`Update`**。注意它接收的是 `Partial<input> | undefined`——渲染历史消息时可能只有部分参数（流式还没到齐、或者旧版本记录里没这个字段），所以每个判断都得容错。"),
    (41, 'before',
     "`old_string === ''` 判成 `Create` 是这套工具的一个约定：**空旧串 = 从零写**。虽然 `FileWriteTool` 才是「创建文件」的正牌工具，但 Edit 在文件不存在时也允许这么用（见 `validateInput`），所以 UI 上也得把它显示成「创建」而不是「更新一个不存在的文件」。"),
    (139, 'before',
     "错误渲染做了**降级**：非 verbose 且错误里含 `File has not been read yet` 时，不显示刺眼的红字，而是灰字 `File must be read first`。理由是这样错是**预期行为**（工具在按规则办事），不是故障——把它渲染成错误会让用户以为出问题了。同理 `FILE_NOT_FOUND_CWD_NOTE` 显示成简洁的 `File not found`。verbose 模式才回落到原始错误文本。"),
    (246, 'after',
     "拒绝编辑的 diff 是**分块读**出来的：`readEditContext(filePath, oldString, CONTEXT_LINES)` 只读第一次出现位置附近的窗口，而不是整文件。注释承认了代价——`replace_all` 时窗口外的匹配看不到，只显示窗口内的——但换来了「用户拒绝一个大文件编辑时不会卡住/爆内存」。这是一个明确的取舍，不是遗漏。"),
    (275, 'after',
     "`adjustHunkLineNumbers(patch, ctx.lineOffset - 1)`：patch 是在**窗口内容**上算出来的，行号从 1 开始，但窗口本身是从文件的第 `lineOffset` 行开始的。差值要减 1（窗口首行对应 patch 的第 1 行，偏移量已是 1-based）。不调整的话，diff 里显示的 `@@ -12 +12 @@` 会和真实文件行号对不上，用户滚动时找不到位置。"),
]
