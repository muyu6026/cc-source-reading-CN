ANNOTATIONS = [
    (1, 'after',
     "常量单独放一个文件的理由是**打破循环依赖**：`FileEditTool.ts` 要 import 权限相关的工具，而权限层、hook 层、UI 层又都需要这个工具名。放在 `constants.ts` 这种「只导出字面量、不 import 任何东西」的叶子模块里，谁都能引用而不会成环。同目录的 `types.ts` 起同样作用。"),
    (10, 'before',
     "这条错误文案被 `FileWriteTool` 也 import 了（`FILE_UNEXPECTEDLY_MODIFIED_ERROR`）。共享而不是各写一份，是因为**两个工具触发它的条件必须一致**：只要「读完之后文件又被改过」就该得到同一句提示。同一个文案还能让上层的重试分类逻辑只匹配一次字符串。"),
]
