# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''导入 path.relative 与 React；本命令用于开关 / 调整沙箱（sandbox）设置'''),
    (10, 'after', '''call 入口：无头命令，返回 React 节点或字符串回执'''),
    (11, 'after', '''读取（已废弃）全局设置，取出主题与平台'''),
    (14, 'after', '''不支持的平台直接报错返回（如 WSL1 只支持 WSL2）'''),
    (22, 'after', '''先查依赖（结构化结果含 errors / warnings）再决定后续流程'''),
    (26, 'after', '''若平台不在 enabledPlatforms 企业名单则拒绝改动'''),
    (33, 'after', '''若被更高优先级策略锁定则拒绝本地修改'''),
    (39, 'after', '''解析参数（trim 后）；空参走交互菜单'''),
    (43, 'after', '''无参时渲染 SandboxSettings 交互菜单组件'''),
    (48, 'after', '''有参时按子命令分流（当前仅 exclude）'''),
    (51, 'after', '''exclude 子命令：把某命令模式加入排除名单'''),
    (61, 'after', '''去掉用户可能自带的引号后再处理'''),
    (64, 'after', '''调用适配器把模式写入排除命令表'''),
    (67, 'after', '''取本地设置文件路径并相对 cwd 展示'''),
    (74, 'after', '''未知子命令报错，提示可用子命令只有 exclude'''),
]
