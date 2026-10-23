ANNOTATIONS = [
    (4, 'before', '''renderToolUseMessage：固定文案 cleanup team: current——没有参数可显示。'''),
    (7, 'before', '''renderToolResultMessage：content 可能是字符串（序列化形态）也可能是对象，先 jsonParse 归一。'''),
    (15, 'before', '''**恒返回 null**——TeamDelete 的结果不渲染。因为批量 shutdown 的汇总消息已经覆盖了「队散了」这件事，再弹一条工具结果行是重复噪音。上面那个 if 是死代码保护区（结构匹配时也返回 null），实际两条路都通向 null。'''),
]
