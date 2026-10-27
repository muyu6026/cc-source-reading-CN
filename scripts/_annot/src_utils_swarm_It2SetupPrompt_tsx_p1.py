# -*- coding: utf-8 -*-
# src/utils/swarm/It2SetupPrompt.tsx（380 行）批注数据
ANNOTATIONS = [
    (11, 'after', '''`SetupStep` 联合类型枚举了安装向导的全部步骤状态。'''),

    (15, 'after', '''`Props` 定义完成回调 `onDone` 与 tmux 是否可用的标记。'''),

    (16, 'after', '''`It2SetupPrompt` 组件入口，`t0` 为传入属性（React Compiler 产物，变量名经压缩）。'''),

    (22, 'after', '''`step` 状态初始为 `initial`（向导起始页）。'''),

    (25, 'after', '''接入 Ctrl+C 退出键绑定，取得退出状态。'''),

    (33, 'after', '''挂载副作用：探测 Python 包管理器并写入状态。'''),

    (41, 'after', '''用 `useEffect` 在挂载时触发包管理器探测。'''),

    (52, 'after', '''`handleCancel` 取消回调，由键绑定复用。'''),

    (65, 'after', '''注册 `confirm:no` 键绑定，触发取消。'''),

    (89, 'after', '''`useInput` 处理安装与验证步骤的回车输入。'''),

    (98, 'after', '''进入安装中状态并调用 `installIt2`。'''),

    (106, 'after', '''`handleInstall` 定义结束。'''),

    (112, 'after', '''`handleInstall` 引用，用于选项切换。'''),

    (118, 'after', '''`handleUseTmux` 设置偏好并回调使用 tmux。'''),

    (124, 'after', '''`handleUseTmux` 引用，供选项使用。'''),

    (169, 'after', '''`renderContent` 按当前步骤切换不同渲染分支。'''),

    (206, 'after', '''初始提示：提供安装 it2、改用 tmux 或取消三个选项。'''),

    (246, 'after', '''安装失败提示，并提供重试、改用 tmux 或取消。'''),

    (303, 'after', '''验证失败提示，并引导用户重新验证或回退 tmux。'''),

    (316, 'after', '''调用 `renderContent` 取得当前步骤的界面内容。'''),

    (341, 'after', '''大段条件渲染闭包结束，进入最终组装。'''),

    (344, 'after', '''退出提示文本随步骤与退出状态变化（再次按键或 Esc 取消）。'''),

    (375, 'after', '''组合最终渲染树并返回。'''),

    (376, 'after', '''`It2SetupPrompt` 组件结束。'''),

    (379, 'after', '''`_temp` 把每条 API 指令渲染为一行文本。'''),
]
