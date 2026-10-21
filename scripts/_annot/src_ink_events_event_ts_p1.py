# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  事件基类：只有「能不能喊停」一件事
// ═══════════════════════════════════════════════════════════════
//
//  整个 ink 里有**两套**事件继承线，这一份是旧的那套的根：
//
//       Event（本文件，11 行）
//         ├─ InputEvent           按键（旧的 useInput 路径）
//         ├─ ClickEvent           点击（hit-test.ts 里手写冒泡）
//         └─ TerminalFocusEvent   终端窗口失焦/获焦（DECSET 1004）
//
//       TerminalEvent（新的，DOM 风格）
//         ├─ KeyboardEvent        onKeyDown
//         └─ FocusEvent           onFocus / onBlur
//
//  terminal-event.ts 的类注释写得很直白：它 extends Event「so existing
//  event types ... can migrate later」—— 也就是**迁移做了一半**。
//
//  为什么基类只有这一个方法？因为 EventEmitter（emitter.ts）只需要知道
//  一件事：还要不要继续叫下一个监听者。它不需要 bubbles、不需要
//  preventDefault、不需要 target。把契约压到最小，两套继承线才能共用
//  同一个 emitter。'''),
    (2, 'after', '''// 布尔标志加 getter，而不是 public 字段：外部只能问「停没停」，
// 不能直接改。听起来像洁癖，但这里有个具体的用法差异 ——
// TerminalEvent 里还有第二个标志 _propagationStopped，
// 那个才是「别往祖先走」，两个概念必须分开记（见 terminal-event.ts:59）。'''),
    (8, 'after', '''// 基类这边只置自己的标志。TerminalEvent 覆写这个方法时会**两个都置**，
// 因为对它来说「立即停」必然蕴含「不往上走」。'''),
]
