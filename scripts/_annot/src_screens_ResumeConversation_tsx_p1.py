# -*- coding: utf-8 -*-
"""screens/ResumeConversation.tsx 批注数据（恢复会话界面，React 编译器产物）。"""

ANNOTATIONS = [
    (1, 'before', '恢复会话界面：列出当前仓库（或全部项目）的历史会话，让用户挑一个继续——挑中后负责把元数据、消息、工作树全部接回'),
    (36, 'before', 'parsePrIdentifier：把用户输入解析成 PR 编号，支持纯数字或 github pull 链接两种写法'),
    (47, 'before', 'Props：界面要的全部入参，含初始工具、MCP 配置、思考配置等'),
    (67, 'before', 'ResumeConversation 主组件：无状态逻辑，只读 Hook 与本地 useState 撑起整个选择流程'),
    (87, 'before', '取终端尺寸，自适应布局'),
    (92, 'before', '日志列表与四种 UI 状态（加载中 / 恢复中 / 全项目开关 / 已选会话）'),
    (109, 'before', 'filteredLogs：按 filterByPr 过滤（未指定 / 真 / 数字 / 字符串），其余原样返回'),
    (125, 'before', '是否启用「恢复时改名」特性'),
    (126, 'before', '首屏加载：渐进式读同仓库的日志，读完后填列表'),
    (137, 'before', 'loadMoreLogs：分批补充日志，用 ref 镜像长度以便保持更新函数纯净'),
    (156, 'before', 'loadLogs：按需读同仓库或全部项目的日志'),
    (169, 'before', 'handleToggleAllProjects：切换全项目开关并重新加载'),
    (174, 'before', 'onCancel：直接退出进程'),
    (178, 'before', 'onSelect：核心——挑中某条日志后，跨项目则复制命令返回、否则加载并接回会话全部状态'),
    (293, 'before', '跨项目情况：直接渲染一条提示，把切换目录的命令交给用户手动执行'),
    (296, 'before', '已选会话：把恢复出的消息与元数据交给 REPL 继续'),
    (299, 'before', '仍在加载：显示转圈'),
    (316, 'before', 'NoConversationsMessage：没可恢复会话时的兜底提示组件'),
    (340, 'before', 'CrossProjectMessage：渲染跨项目提示与需手动运行的命令'),
    (392, 'before', '_temp3：跨项目提示的副作用定时器，到点自动退出'),
]
