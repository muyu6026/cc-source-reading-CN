// 一个数字，两处用途，两种含义 —— 这是它值得单独成文件的原因。
//
//  **渲染节流**：`ink.tsx` 用它做「最快多久重绘一次」，也就是 60fps。
//  注意这是**上限而不是目标**：没人要求每 16ms 画一帧，只是在
//  「有变更」时不要比这更快。
//
//  **时钟节拍**：`ClockContext.tsx` 用它作为动画的时间步长
//  （spinner、闪烁光标）。那里还有一条：失焦时翻倍成 32ms
//  （`BLURRED_TICK_INTERVAL_MS`）—— 用户不在看的时候省一半 CPU。
//
//  两个用途绑同一个常量，意味着「改帧率」会同时改动画速度。
//  这在动画是按「每 tick 走一格」实现时是对的；但如果哪天动画改成
//  按真实时间插值，就得拆成两个常量了。
// Shared frame interval for render throttling and animations (~60fps)
export const FRAME_INTERVAL_MS = 16
