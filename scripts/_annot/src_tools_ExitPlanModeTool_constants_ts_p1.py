ANNOTATIONS = [
    (1, 'before', r'''EXIT_PLAN_MODE_TOOL_NAME 与 EXIT_PLAN_MODE_V2_TOOL_NAME 两个导出同值——V1 名字保留给兼容层（旧 hook/旧 SDK 客户端按旧名匹配），V2 是现行实现名。改名不改值的过渡期标本。'''),
    (2, 'after', r'''工具名字符串本身是公开契约：出现在 deferred 工具列表、权限规则、遥测事件名里，改它等于改接口。'''),
]
