ANNOTATIONS = [
    (1, 'before', """模块总述：用 OSC 8 转义序列在终端渲染可点击超链接，终端不支持时回退为纯文本 URL。"""),
    (7, 'after', """两个转义常量：链接起始标记 `OSC8_START` 与终止标记 `OSC8_END`，后者采用响铃字符作终止符，兼容性比 ST 字符更佳。"""),
    (12, 'after', """HyperlinkOptions 选项类型：仅暴露 `supportsHyperlinks` 覆盖开关，便于测试时强制指定是否支持。"""),
    (24, 'before', """createHyperlink 工厂：先判断是否支持超链接，不支持则直接返回原始 URL，支持时按需把展示文本着色后包裹进 OSC 8 序列。"""),
    (38, 'after', """返回拼接结果：起始标记 + URL + 终止标记 + 着色文本 + 再次起始/终止标记闭合，形成完整 OSC 8 链接。"""),
]
