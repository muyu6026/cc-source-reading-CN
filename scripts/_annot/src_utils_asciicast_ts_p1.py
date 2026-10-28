# -*- coding: utf-8 -*-
# 批注：src/utils/asciicast.ts
ANNOTATIONS = [
    (16, 'after', '录制状态挂在模块级：filePath 会随会话切换（如 --resume）而更新'),
    (24, 'before', '取录制文件路径：仅 ant 类型且开了终端录制时返回路径，否则 null；结果缓存到 recordingState'),
    (46, 'before', '测试专用：清空录制状态'),
    (55, 'before', '找出当前会话的全部 .cast 文件，按文件名（时间戳后缀）排序'),
    (82, 'before', '会话 ID 变化（--resume/--continue）后把录制文件改名，使其仍能被新会话 ID 找到'),
    (118, 'before', '直接读 stdout 的行列尺寸（这里不在 React 组件内）'),
    (140, 'before', '安装录制器：包住 process.stdout.write 抓取带时间戳的终端输出；须在 Ink 挂载前调用'),
    (159, 'after', '写 asciicast v2 协议头，记录宽高、起始时间戳与终端环境'),
    (170, 'after', '用链式 Promise 把异步写串行化，避免落盘顺序乱掉'),
    (210, 'after', '重写 stdout.write：把输出事件连同耗时写进录制器，再透传给真正的 stdout'),
    (218, 'after', '监听终端尺寸变化并记录 resize 事件'),
    (236, 'after', '注册退出清理：释放录制器并把被替换的 stdout.write 还原'),
]
