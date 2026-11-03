# 数据文件：src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx
# slug = src_components_permissions_ExitPlanModePermissionRequest_ExitPlanModePermissionRequest_tsx
# 规则：一个源文件 = 一个数据文件；中文用三引号；禁止英文双引号 " 与反斜杠 \（用「」/『』代替）。
ANNOTATIONS = [
    (1, 'before', '''本文件是「退出计划模式」的权限请求对话框组件。用户在这里选择如何退出计划模式——清上下文并接受编辑、保留上下文、切到自动模式、改用 Ultraplan，或拒绝并继续规划。第 43 行用 feature 开关做条件 require，仅在启用转录分类器时才加载 autoModeState 模块（bun:bundle 的摇树约束要求 feature 直接写在 if 或三元里）。'''),
    (50, 'after', '''ResponseValue 是退出计划时可选项的值集合：绕过权限、接受编辑、接受编辑并保留上下文、默认保留上下文、恢复自动模式、自动清上下文、改用 Ultraplan、以及否。'''),
    (56, 'before', '''buildPermissionUpdates 根据所选权限模式构造权限更新数组：先写一条 setMode，若分类器权限开启且提供了允许提示则追加 addRules 规则（仅 Ant 可用）。'''),
    (76, 'after', '''buildPermissionUpdates 收尾，返回由 setMode 与可选 addRules 组成的更新列表。'''),
    (83, 'before', '''autoNameSessionFromPlan 在用户接受计划时按计划内容自动给会话命名，属于 fire-and-forget；命名前先检查会话持久化是否被禁用、以及用户是否已手动命名，避免覆盖。'''),
    (117, 'after', '''autoNameSessionFromPlan 收尾：生成名字后写入自定义标题与智能体名，并在 AppState 里更新 standaloneAgentContext，失败仅记日志不阻塞。'''),
    (118, 'before', '''ExitPlanModePermissionRequest 主组件入口。它从全局状态取出工具权限上下文、通知与编辑器信息，并初始化计划文本、反馈输入、粘贴图片等状态。'''),
    (134, 'after', '''planFeedback 收集「否」选项输入框里的反馈文本，会随批准回调以 acceptFeedback 透传，让用户无需先拒绝再重规划就能给计划加注「顺手更新 README」之类的要求。'''),
    (158, 'after', '''options 用 useMemo 记忆化，调 buildPlanApprovalOptions 按是否清上下文、是否显示 Ultraplan、模式可用性等组装批准选项。'''),
    (175, 'after', '''onImagePaste 处理图片粘贴：分配自增粘贴 id，写缓存与图片存储，再并入 pastedContents，供拒绝时把截图作为附件回传。'''),
    (184, 'after', '''onRemoveImage 是删除某张已粘贴图片的回调，从 pastedContents 里删掉对应 id。'''),
    (201, 'after', '''rawPlan 取计划原文（V2 走磁盘文件，V1 走 input.plan），isEmpty 标记计划是否为空，空计划走简化界面。'''),
    (217, 'after', '''planEditedLocally 标记用户是否用 Ctrl+G 在外部编辑器改过计划；只有本地改过时才把计划回写进工具输入，否则模型已在上下文里拥有最新计划。'''),
    (225, 'after', '''该 useEffect 在 showSaveMessage 为真时启动五秒定时器自动隐藏「计划已保存」提示。'''),
    (273, 'after', '''handleKeyDown 绑定 Ctrl+G 在外部编辑器改计划、Shift+Tab 直接选「自动接受编辑」；改动后更新当前计划并触发保存提示，异常时弹通知。'''),
    (508, 'after', '''handleResponse 是核心分派：按所选退出值分别处理 Ultraplan 转交、清上下文（含自动模式去激活与权限恢复）、恢复自动模式、保留上下文、标准批准与拒绝，最后调用 onAllow 或 onReject 解挂查询循环。'''),
    (519, 'after', '''handleResponseRef 把 handleResponse 包进 ref，使 JSX（仅随选项或图片变化注册一次）能调用最新闭包而不在每次按键时重注册。'''),
    (555, 'after', '''useLayoutEffect 在 fullscreen 模式（提供 setStickyFooter）下把批准选项渲染进底部固定区，长计划滚动时仍可见，卸载时清空。'''),
    (600, 'after', '''handleEmptyPlanResponse 处理空计划的「是 / 否」：是则退出计划并设默认模式，否则仅解挂查询循环，二者都记 plan_exit 事件。'''),
    (671, 'after', '''ExitPlanModePermissionRequest 主组件收尾：非空计划渲染计划预览、权限说明、可选请求权限列表与批准 Select（JSX 在 626 行至 670 行）。'''),
    (674, 'before', '''buildPlanApprovalOptions 按优先级（自动模式 > 绕过权限 > 接受编辑）组装批准选项列表，并视情况追加 Ultraplan 与带反馈输入的「否」选项（上方文档块在 673 行，锚签名行以免插入块内）。'''),
    (745, 'after', '''buildPlanApprovalOptions 收尾，返回组装完成的选项数组。'''),
    (747, 'before', '''getContextUsedPercent 估算当前上下文已用百分比，供「清上下文」选项显示「已用 X%」提示，便于用户判断要不要清上下文。'''),
    (767, 'after', '''getContextUsedPercent 收尾，返回 used 百分比（无 usage 时返回 null）。'''),
]
