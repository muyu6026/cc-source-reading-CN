ANNOTATIONS = [
    (1, 'after', """REPL 启动器：组装应用与 REPL 两层组件并交给渲染器运行，重组件均动态导入以控体积。"""),
    (7, 'after', """`AppWrapperProps`：传给应用外壳的属性，含帧率指标获取器、统计存储与初始状态。"""),
    (12, 'after', """`launchRepl` 入口：参数含根节点、两组 props 与渲染回调，返回 Promise 以便 await 启动。"""),
    (21, 'after', """把 `App`/`REPL` 与各自 props 组合后一次性渲染并启动 REPL。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
