# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (13, 'before', '新建代理向导的描述步骤（第二步）。标题副文案里点明用途：告诉 Claude 什么时候该用这个代理，也就是系统提示词里的 whenToUse 字段。'),
    (21, 'before', '本地状态初始化自向导数据：返回编辑本步时能恢复已填内容。光标偏移同步初始化在文本末尾，避免返回编辑时光标跳到开头。'),
    (22, 'before', 'cursorOffset 与文本一起受控：输入时 onChangeCursorOffset 同步，外部编辑器返回时也重置到末尾。TextInput 的受控光标见第 96 行。'),
    (33, 'before', 'confirm:no（默认 Esc）绑定 goBack：在 Settings 上下文里返回上一步。useKeybinding 第三参数是作用域描述对象，进常量槽。'),
    (36, 'before', '外部编辑器回调：把当前文本交给 editPromptInEditor，用户在 $EDITOR 里改完返回后写回文本并重置光标。content 为 null 表示用户清空或取消编辑器，此时不动原文本。'),
    (58, 'before', 'chat:externalEditor（默认 ctrl+g）绑定同一回调：长描述适合在外部编辑器里写，快捷键提示在 Byline 里可见（第 82 行）。'),
    (61, 'before', '提交校验：trim 后为空就地报错不前进；合法则把修剪后的值写回向导数据并 goNext。错误只在提交瞬间产生，输入变化不会主动清除（见第 105 行，error 状态只在下次提交时被覆盖）。'),
    (82, 'before', 'Byline 快捷键提示行：输入、回车继续、ctrl+g 外部编辑、Esc 返回。四条提示全部进常量槽，与文本内容一样只建一次。'),
    (96, 'before', 'TextInput 配置：columns 固定 80 而不是跟随终端宽度——向导弹窗有固定框架，输入区宽度独立于主界面。focus 与 showCursor 恒真，本步只有一个输入焦点。'),
    (105, 'before', '错误显示：error 非空时渲染红色文本。编译器把它单独缓存一段——大多数渲染里 error 为 null，t7 直接复用 null 槽，不拖累其他段落。'),
]
