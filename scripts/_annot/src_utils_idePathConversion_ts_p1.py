# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''IDE 与 Claude 两套环境的路径换算：典型场景是 Windows 侧的 IDE 配 WSL 里的 Claude，双方对同一个文件的写法完全不同。'''),
    (6, 'after', '''直接起 wslpath 子进程换算：WSL 自带此工具，比手写规则覆盖面广（网络路径、映射盘等），失败再退回手写。'''),
    (20, 'after', '''接口只有两个方向：toLocalPath 进（读 IDE 锁文件里的工作区）、toIDEPath 出（把路径发回 IDE 打差异视图）。'''),
    (26, 'after', '''构造器只存发行版名：WSL 允许多发行版并存，UNC 路径里嵌着发行版名，跨发行版的路径 wslpath 换算不了。'''),
    (40, 'after', '''跨发行版直接原样返回：wslpath 对别的发行版的 UNC 路径会失败，与其吃一次异常不如先判后行。'''),
    (56, 'after', '''转换失败的兜底是手写规则：反斜杠换正斜杠、盘符换成 /mnt 小写挂载点。粗但够用，wslpath 不可用时（如发行版未装）不至于完全失效。'''),
    (74, 'after', '''反方向不做手写兜底：WSL 到 Windows 的路径只有一个消费者（IDE 显示），换不出来就发原样，IDE 侧自己会报。'''),
    (90, 'after', '''checkWSLDistroMatch 是给外面复用的判定：不是 WSL UNC 路径视为匹配（返回 true），是的话才比发行版名。'''),
]
