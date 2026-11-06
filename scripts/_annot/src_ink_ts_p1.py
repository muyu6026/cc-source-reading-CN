# -*- coding: utf-8 -*-
# 第 167 批：src/ink.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''依赖：React createElement、设计系统 ThemeProvider、ink 渲染器与根 API。'''),
    (9, 'after', '''re-export 渲染选项、实例、根类型，方便外部直接用 ink 的类型。'''),
    (16, 'after', '''withTheme：把节点包进 ThemeProvider，让 ThemedBox、ThemedText 不用每个调用点都挂主题。'''),
    (23, 'after', '''render：对外渲染入口，自动套主题后交给 ink 真正的渲染器。'''),
    (31, 'after', '''createRoot：包一层根，render 方法自动套主题，返回的原 root 其余能力不变。'''),
    (33, 'after', '''下面是一长串再导出：把设计系统组件与 ink 内部模块统一从这里暴露。'''),
    (44, 'after', '''导出 Ansi 转义组件：直接输出原始 ANSI 序列。'''),
    (57, 'after', '''导出 NoSelect、RawAnsi、Spacer 等基础组件。'''),
    (66, 'after', '''导出事件系统：EventEmitter 与各类事件类型。'''),
    (85, 'after', '''文件收尾：wrap-text 是最后一个导出，ink 的公共 API 面到此集结完毕。'''),
]
