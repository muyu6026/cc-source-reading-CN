# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 【`!命令` 这一行在历史里的样子：深色底 + 一个感叹号前缀】
//
//  配色和输入框的 bash 边框一致（bashBorder / bashMessageBackgroundColor），
//  这样用户在输入时和回看时看到的是同一套视觉语言。
//
//  整个文件只有 57 行，但它和 UserPromptMessage 是对称的一对：
//  同样是「用户说的话」，一个走聊天通道、一个走 bash 通道。'''),

    (20, 'before', '''// 【extractTag 拿不到 bash-input 就返回 null】
//
//  这个 null 不是「出错了」，而是「这条消息不归我管」——
//  UserTextMessage 在分发时用的是 `param.text.includes('<bash-input>')`，
//  包含但抠不出来（比如只有开标签没有闭标签）时，宁可不渲染。
//
//  这是分发层的一贯做法：**判断用 includes（宽），渲染用 extractTag（严）**。
//  宽的那一步负责把消息送对地方，严的那一步负责在数据损坏时安静地失败。'''),

    (34, 'before', '''// 【静态的「! 」前缀节点用 sentinel，内容跟着 input 变】
//
//  注意 input 在这里已经是纯文本了，没有再做任何 Markdown 解析 ——
//  bash 命令按原样显示，连换行都保留。这是刻意的：
//  一条 shell 命令里 `*` `_` `#` 都是语法字符，走 Markdown 会被吃掉。'''),
]
