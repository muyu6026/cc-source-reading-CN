# 源文件: src/commands/feedback/feedback.tsx
ANNOTATIONS = [
    (7, 'after', '''文件定位：这个文件负责把 Feedback 组件渲染出来，供反馈命令调用。'''),
    (19, 'after', '''渲染函数：把 abortSignal、messages、初始描述、后台任务等装配进 Feedback 组件并返回。'''),
    (21, 'after', '''命令入口 call：接收 onDone、命令上下文与可选参数。'''),
    (24, 'after', '''call 的实现：从命令上下文取出 abortController 的 signal 与 messages，用户输入作为 initialDescription 转交给渲染函数。'''),
]
