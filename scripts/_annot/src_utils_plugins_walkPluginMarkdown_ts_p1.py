ANNOTATIONS = [
    (1, 'before', """插件目录 Markdown 遍历器：递归走一个插件目录，对每个 .md 文件回调 onFile，并携带相对根的子目录命名空间。"""),
    (5, 'after', """匹配 SKILL.md 的正则（大小写不敏感），用于识别 skill 目录。"""),
    (7, 'after', """模块文档：递归遍历插件目录，对每个 .md 文件调用 onFile；namespace 数组记录相对根的子目录路径。当 stopAtSkillDir 为真且某目录含 SKILL.md 时，只处理该目录的 .md 而不再下钻（skill 目录是叶子容器）。readdir 出错只打调试日志，不中断整个插件加载。"""),
    (21, 'before', """遍历主函数：接收根目录、onFile 回调与可选 opts（是否遇 skill 目录即停、日志标签），默认空选项。"""),
    (29, 'after', """内部递归 scan：先读目录项，命中 skill 目录规则就只收集本目录 .md，否则继续下钻或回调文件。"""),
    (33, 'after', """若开启 stopAtSkillDir 且本目录含 SKILL.md：收集当前目录全部 .md 后返回，不再递归子目录。"""),
    (68, 'after', """从根目录启动递归扫描，初始命名空间为空数组。"""),
    (69, 'after', """遍历器收尾：整体是一次性异步遍历，不返回结果，仅通过 onFile 副作用把 .md 交给调用方处理。"""),
]
