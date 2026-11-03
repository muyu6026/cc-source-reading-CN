ANNOTATIONS = [
    (1, 'after', '''TeleportResumeWrapper 是从远端恢复会话流程的总装组件：负责会话选择、加载态、错误展示，并把结果回传给上层。'''),
    (17, 'after', '''Props 暴露 onComplete / onCancel / onError 三个回调，以及是否内嵌、来源 source 两个开关。'''),
    (19, 'after', '''文件头注释说明本组件管理整个 teleport resume 流程，包括会话选择、加载态和错误处理。'''),
    (32, 'after', '''组件解构 props，并把 isEmbedded 的 undefined 兜底成 false；随后从 useTeleportResume 拿到恢复动作和状态。'''),
    (38, 'after', '''useTeleportResume 按 source 提供 resumeSession / isResuming / error / selectedSession。'''),
    (55, 'after', '''进入时打一个 tengu_teleport_started 埋点，source 作为事件属性；依赖只在 source 变化时重打。'''),
    (77, 'after', '''handleSelect 调用 resumeSession，成功就 onComplete(result)，失败且存在 error 时通过 onError 把 message 和格式化信息回传。'''),
    (90, 'after', '''handleCancel 先打 tengu_teleport_cancelled 埋点再调用 onCancel。'''),
    (102, 'after', '''当既有 error 又没有 onError 时，把 app:interrupt 键绑定到 handleCancel，用于让用户能中断。'''),
    (120, 'after', '''正在恢复且有选中会话时，展示 Resuming session 加转圈，并提示正在加载哪个会话标题。'''),
    (153, 'after', '''若恢复出错且没设 onError（自己处理不了），就直接渲染失败文案加具体错误和 Esc 取消提示。'''),
    (165, 'after', '''正常情况把选择 / 取消 / 内嵌三个开关透传给 ResumeTask 组件，由它负责真正的会话列表 UI，组件返回拼装好的 ResumeTask。'''),
]
