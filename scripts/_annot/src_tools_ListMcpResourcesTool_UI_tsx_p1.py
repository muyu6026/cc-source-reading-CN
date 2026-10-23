ANNOTATIONS = [
    (9, 'before', '''renderToolUseMessage 按有没有 server 参数分叉文案。'''),
    (14, 'before', '''renderToolResultMessage：空结果一行置灰提示；有结果走 OutputLine 组件。'''),
    (19, 'before', '''空结果分支。'''),
    (26, 'after', '''这里 jsonStringify 带 eslint-disable-next-line no-restricted-syntax——注释写明理由：这是**给人看的 UI**，不是 tool_result，不受那条「禁止 UI 里手写 JSON 序列化」规则管。全仓 UI 文件里的标准豁免写法。'''),
]
