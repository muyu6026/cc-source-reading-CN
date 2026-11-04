# 批注数据：source/src/components/agents/new-agent-creation/wizard-steps/ModelStep.tsx
ANNOTATIONS = [
    (10, 'before', '''新建 agent 向导的「选择模型」步骤：组装底部快捷键提示并渲染模型选择对话框。'''),
    (17, 'after', '''从向导上下文取出导航与数据回调，以及当前已选模型。'''),
    (32, 'after', '''将构造好的完成回调暴露给后续渲染使用。'''),
    (35, 'after', '''构造底部快捷键提示行（Byline 包裹各类 hint）。'''),
    (42, 'after', '''渲染向导对话框，内部挂载模型选择器并绑定完成/取消回调。'''),
    (50, 'after', '''返回组装好的对话框节点。'''),
]
