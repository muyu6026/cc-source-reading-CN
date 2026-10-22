"""批注数据：src/tools/GlobTool/UI.tsx（62 行）"""

ANNOTATIONS = [
    (10, 'after', "这份 UI 直接 import GrepTool——为了复用它的 renderToolResultMessage（见下方 53 行的赋值）。两个「Search」工具共用同一套结果渲染，改一处两个工具同时生效。"),
    (13, 'after', "对外名称统一叫「Search」——GrepTool.userFacingName 同样返回 Search。用户在 UI 里看到的不是两个工具名，而是同一个「Search」类别；区分靠 pattern 内容本身。"),
    (50, 'after', "错误降级模式与 FileReadTool/UI 相同：非 verbose 时只给一句「File not found」或「Error searching files」，详细信息折叠进可展开区域。判断依据是错误文本里是否带 FILE_NOT_FOUND_CWD_NOTE 标记。"),
    (53, 'after', "一行赋值完成复用：Glob 的结果渲染 = Grep 的实现。这是「孪生工具共享 UI 层」的最省做法——比抽公共组件还少一层间接。"),
]
