ANNOTATIONS = [
    (10, 'after', '''文件级说明：因 Ink 不支持同一渲染树多个 Static 组件，改为把组件渲染成字符串再打印到标准输出。'''),
    (51, 'after', '''RenderOnceAndExit 收尾：用 useLayoutEffect 等 React 提交阶段完成后再退出，比 nextTick 更稳。'''),
    (55, 'after', '''DEC 同步更新标记：终端用 [?2026h 与 [?2026l 包裹整帧输出。'''),
    (69, 'after', '''extractFirstFrame 收尾：只取首个同步更新段的内容，避免非 TTY 模式多帧重复。'''),
    (107, 'after', '''renderToAnsiString 收尾：把 React 节点渲染为带 ANSI 转义的字符串，可指定列宽。'''),
    (115, 'after', '''renderToString 收尾：在上层基础上 strip 掉 ANSI 码得到纯文本。'''),
]
