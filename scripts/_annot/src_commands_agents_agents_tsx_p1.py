# 批注数据：source/src/commands/agents/agents.tsx
ANNOTATIONS = [
    (1, 'before', '''本文件实现 `agents` 命令的本地 JSX 渲染：打开智能体管理菜单。
与前面只导出命令对象的文件不同，这里是真正执行渲染的入口。'''),
    (5, 'after', '''`call` 是本地 JSX 命令的入口函数，接收 `onDone` 回调与工具上下文，
返回一段 React 节点交给界面渲染。'''),
    (8, 'after', '''从权限上下文里取出可用工具列表，传给菜单做展示与选择。'''),
    (9, 'after', '''渲染 `AgentsMenu` 组件，把工具列表与退出回调 `onDone` 作为属性传入。'''),
]
