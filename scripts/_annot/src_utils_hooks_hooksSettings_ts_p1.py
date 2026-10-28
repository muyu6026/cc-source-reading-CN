# 批注数据：source/src/utils/hooks/hooksSettings.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (1, 'before', """注：本文件汇总与展示「钩子（Hook）设置」——把来自用户/项目/本地/会话/插件/内置等多来源的钩子收集成统一结构，并提供排序与展示文案。"""),
    (15, 'before', """注：HookSource 是钩子来源的并集类型，除了三种可编辑来源，还含策略设置、插件、会话与内置四类。"""),
    (22, 'before', """注：IndividualHookConfig 描述单条钩子的扁平记录：事件名、命令配置、匹配串、来源，以及可选的插件名。"""),
    (33, 'before', """注：isHookEqual 判断两条钩子是否等价，只比较命令/提示/代理/网址内容与匹配条件，不比较超时；函数型钩子无法比较，恒返回 false。"""),
    (67, 'before', """注：getHookDisplayText 返回钩子的展示文本：优先用自定义状态消息，否则按类型取命令串、提示串、网址或回调/函数字样。"""),
    (92, 'before', """注：getAllHooks 是核心收集器：若未限定只显示受管钩子，就从用户/项目/本地三种来源去重收集，再并入会话钩子。"""),
    (163, 'before', """注：getHooksForEvent 是便捷封装，按事件名过滤 getAllHooks 的结果。"""),
    (170, 'before', """注：三个 hookSource 开头的展示函数分别给出来源的完整路径说明、分组标题与内联短名，供 UI 三处展示。"""),
    (230, 'before', """注：sortMatchersByPriority 按来源优先级给匹配串排序：可编辑来源按 SOURCES 顺序，插件与内置排到最后，同级再按名称排序。"""),
]
