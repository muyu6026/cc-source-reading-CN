ANNOTATIONS = [
    (1, 'before', '''解析层：把按键输入映射到动作，纯函数无副作用'''),
    (10, 'before', '''ResolveResult：单键解析的三种结果（命中 / 无 / 未绑定）'''),
    (15, 'before', '''ChordResolveResult：和弦解析的扩展结果（额外含和弦开始 / 取消）'''),
    (32, 'before', '''resolveKey：单键解析——只匹配单键绑定，最后命中者胜出（用户覆盖优先）'''),
    (67, 'before', '''getBindingDisplayText：按动作加上下文反查显示用按键串（如「ctrl+t」），逆序查找以尊重覆盖'''),
    (82, 'before', '''buildKeystroke：由 Ink 的 input/key 构造 ParsedKeystroke；注意 escape 不应记为 meta 修饰'''),
    (107, 'before', '''keystrokesEqual：比较两个按键是否相等，alt/meta 归并为同一逻辑修饰'''),
    (123, 'before', '''chordPrefixMatches：判断前缀是否匹配某绑定和弦的开头'''),
    (140, 'before', '''chordExactlyMatches：判断完整和弦是否与绑定逐键相等'''),
    (166, 'before', '''resolveKeyWithChordState：支持和弦状态的多键解析（如「ctrl+k ctrl+s」），处理开始 / 取消 / 命中 / 无'''),
    (244, 'after', '''resolver 模块结束：导出单键与和弦两套解析函数'''),
]
