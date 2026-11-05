ANNOTATIONS = [
    (1, 'before', '''React Compiler 运行时与各类组件 / 工具导入'''),
    (26, 'before', '''BtwComponentProps：/btw 侧问组件的属性（问题、上下文、完成回调）'''),
    (33, 'before', '''CHROME_ROWS / OUTER_CHROME_ROWS / SCROLL_LINES：渲染外框与滚动用的行数常量'''),
    (36, 'before', '''BtwSideQuestion：/btw 侧问的渲染组件，用 React Compiler 缓存 memo 槽，含键盘处理 / 拉取回答 / 滚动'''),
    (198, 'before', '''`_temp`：帧计数器自增函数（用于旋转动画），编译产物的命名'''),
    (201, 'before', '''stripInProgressAssistantMessage：去掉末尾未完成的助手消息，避免把半截回答纳入上下文'''),
    (208, 'before', '''buildCacheSafeParams：为侧问构造缓存友好参数，优先复用停止钩子捕获的提示词 / 上下文以命中提示词缓存，否则从零重建'''),
    (229, 'before', '''call：/btw 命令入口——取参数作为问题，计数加一，渲染侧问组件'''),
    (242, 'after', '''btw 模块结束：返回侧问组件'''),
]
