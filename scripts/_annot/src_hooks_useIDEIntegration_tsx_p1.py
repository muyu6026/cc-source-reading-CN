# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (15, 'after', '''// React Compiler 把整个 props 对象编译重命名为形参 t0，内部再解构成各字段。'''),
    (26, 'after', '''// 依赖数组手写比对五个字段，任一变化才重建 effect 回调 t1（memo 守卫，避免每轮重订阅）。'''),
    (33, 'after', '''// 自动连接 IDE 的多路触发：config 开关 / 启动 flag / 受支持终端 / SSE 端口 / 待装扩展 / env 真值；\n// 末尾再 && 一个「env 非假值」做负向熔断（env 显式关时强制不连）。'''),
    (44, 'after', '''// 按 URL 前缀区分传输协议：ws: 起头用 ws-ide，其余按 sse-ide 处理。'''),
    (54, 'after', '''// 真正触发 IDE 集成初始化：传入 addIde 回调（命中则写 dynamic MCP config）、\n// 待装扩展、引导开关、安装状态回调。'''),
]
