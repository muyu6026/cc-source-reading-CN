# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (47, 'after', '''FilePermissionDialogProps 是带泛型的 props 类型：
调用方可传入自己的 ToolInput 子类型 T，languageName 缺省时由路径推断。'''),
    (64, 'after', '''组件函数签名，泛型 T 默认 ToolInput，解构出大量 props 后开始组装 UI。'''),
    (89, 'after', '''useMemo 计算符号链接目标：
仅当存在符号链接且指向工作目录外时返回真实路径，用于后续安全提示。'''),
    (114, 'after', '''用调用方提供的解析器把工具输入解析成强类型对象 parsedInput。'''),
    (154, 'after', '''useDiffInIDE 负责在 IDE 中展示差异：返回是否正在展示、关闭方法、IDE 名。'''),
    (161, 'after', '''若正在 IDE 中展示 diff，则渲染 ShowInIDEPrompt 而不是默认对话框。'''),
    (203, 'after', '''否则渲染标准权限对话框 + 选择列表，并根据选项类型分派 accept/reject 回调。'''),
]
