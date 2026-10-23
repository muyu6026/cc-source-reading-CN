ANNOTATIONS = [
    (32, 'after', r'''文件级：vim 模式输入层，包在 useTextInput 外面。props 与 UseTextInputProps 同构（Omit 掉 inputFilter 再原样加回——只为调整文档位置），外加 onModeChange/onUndo。'''),
    (46, 'after', r'''inputFilter 刻意不传给 useTextInput，改在 handleVimInput 顶部统一跑——注释解释：vim 处理的路径可能不调 textInput.onInput 就返回，filter 在底层会被跳过，stateful filter（如 pill 后的懒空格）会跨 Escape → NORMAL → INSERT 往返保持 armed。'''),
    (59, 'after', r'''switchToInsertMode：进入 INSERT 重置 insertedText（dot-repeat 的累积起点）。'''),
    (80, 'after', r'''switchToNormalMode 两个 vim 标准行为：① 退出 insert 前把累积的 insertedText 存进 lastChange（供 . 重放）；② 光标左移一格（除非在行首或 offset 0）——vim 的 insert→normal 光标语义。'''),
    (107, 'after', r'''createOperatorContext：operators.ts 的依赖注入接口。register/lastFind 存活在 persistentRef（跨模式、跨命令）；recordChange 在 isReplay 时换成 no-op——重放 . 命令时不再记录「最后一次变更」，否则 . 会嵌套放大。'''),
    (173, 'after', r'''replayLastChange：vim 的 . 命令。按 lastChange 的九种类型（insert/x/replace/toggleCase/indent/join/openLine/operator/operatorFind/operatorTextObj）分派重放——每种变更类型都要能无损重放，这是 dot-repeat 完整性的检查单。'''),
    (207, 'after', r'''handleVimInput 的分流顺序：① inputFilter 只在 INSERT 应用变换（NORMAL 命令查找期待单字符，前置空格会破坏匹配）② Ctrl 一律直通 base ③ Escape 双模式——INSERT 转 NORMAL（NOTE(keybindings) 注释：vim 的 Esc 语义不该可配置）；NORMAL 取消 pending 命令 ④ Enter 任何模式都直通（NORMAL 模式也能提交）。'''),
    (229, 'after', r'''INSERT 模式的 dot-repeat 累积：退格/删除按 lastGrapheme 长度回退（组合字符/emoji 不能按 UTF-16 码元切），其他输入累加。'''),
    (243, 'after', r'''NORMAL idle 状态方向键委派 base handler——空闲时方向键是光标移动+历史回退，不是 hjkl 之外的第二种命令。'''),
    (272, 'after', r'''expectsMotion 状态机注释是精髓：backspace/delete 只在期待动作的状态（idle/count/operator/operatorCount）映射成 h/x——在字面量状态（replace/find/operatorFix）映射会把 r+Backspace 变成「替换成 h」、df+Delete 变成「删到下一个 x」。Delete 额外跳过 count 状态（vim 里 N<Del> 是删数字位，不实现但至少别把取消变成破坏性 Nx）。方向键全模式映射 hjkl。'''),
    (295, 'after', r'''transition 分派后两级更新：先 execute 再按结果推进 command 状态——execute 可能自己切 INSERT（如 i/o/a），那时不能再覆写回 NORMAL。? 在 idle 时特殊放行：直接进输入框而不是当命令（用户要打问号开头的内容）。'''),
    (316, 'after', r'''返回 spread textInput（渲染/offset 全复用）+ onInput 覆写成 vim 版 + mode/setMode（外部可切模式，如斜杠命令强制 INSERT）。'''),
]
