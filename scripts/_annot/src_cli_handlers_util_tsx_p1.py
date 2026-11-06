# -*- coding: utf-8 -*-
"""src/cli/handlers/util.tsx 批注数据（第 165 批，编译器产物）。"""

ANNOTATIONS = [
    (1, 'before', '''杂项子命令处理器，从 main.tsx 抽出做懒加载：setup-token、doctor、install'''),
    (6, 'before', '''CLI 子命令处理器有意退出进程，所以对 no-process-exit 规则整文件豁免'''),
    (20, 'before', '''setup-token：引导 OAuth 长寿命令牌流程，已有环境变量鉴权时给警告，结束后直接 process.exit(0)'''),
    (24, 'before', '''动态导入 OAuth 流程组件，避免它进主包、拖慢启动'''),
    (49, 'before', '''渲染完成后卸载根节点并退出；OAuth 流程在 onDone 里 resolve'''),
    (52, 'before', '''doctor 命令用懒加载包一层，避免启动时就把整个 Doctor 屏拉进来'''),
    (56, 'before', '''编译器产物：只记忆化 onDone 一个依赖，Suspense 包裹 Doctor 做懒加载'''),
    (72, 'before', '''doctor：把 AppState / MCP / 插件管理都挂上，渲染 Doctor 屏后退出'''),
    (89, 'before', '''install：先拉 setup 初始化，再调 install 跑安装；失败结果映射成退出码 1'''),
    (104, 'before', '''install 的回调里按结果含不含 failed 决定退出码，结束 process'''),
]
