# -*- coding: utf-8 -*-
# annotations for src/components/DiagnosticsDisplay.tsx (95 lines)
ANNOTATIONS = [
    (17, 'before', '诊断信息附件展示：verbose 模式逐文件逐条列出，精简模式只报一行汇总'),
    (23, 'after', '无诊断文件直接返回 null——注释写明 Only show if there are diagnostics to report'),
    (28, 'after', 'reduce 求总问题数：_temp 累加每个文件的 diagnostics.length'),
    (36, 'before', 'verbose 分支：逐文件渲染（路径加粗 + 协议来源标注），每条诊断单独一行'),
    (63, 'after', '单复数：issue/issues 与 file/files 双重处理'),
    (67, 'after', 'CtrlOToExpand 提示用户可展开看详情——精简模式的出口'),
    (87, 'after', '文件路径三段处理：去掉 file:// 与 _claude_fs_right: 前缀，再 relative 到 cwd 得短路径；协议标注从 URI 前缀推断（file:// 或 claude_fs_right 或取冒号前的 scheme）'),
    (90, 'after', '诊断条目格式：缩进 + severity 符号 + [Line 行:列]（0 基转 1 基）+ 消息 + 可选 [code] 与 (source)'),
    (92, 'before', '_temp 即求和 reducer：(sum, file)=sum+file.diagnostics.length'),
]
