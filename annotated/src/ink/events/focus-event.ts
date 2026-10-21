import { type EventTarget, TerminalEvent } from './terminal-event.js'

/**
 * Focus event for component focus changes.
 *
 * Dispatched when focus moves between elements. 'focus' fires on the
 * newly focused element, 'blur' fires on the previously focused one.
 * Both bubble, matching react-dom's use of focusin/focusout semantics
 * so parent components can observe descendant focus changes.
 */
// 两条注释里的取舍值得记住：
//
//   bubbles: true      → 对应 DOM 的 **focusin/focusout**，不是
//                        focus/blur。后者不冒泡，父组件收不到子组件的
//                        焦点变化；终端 UI 里父容器（列表、表单）
//                        几乎总要知道「我的某个孩子拿到焦点了」，
//                        所以选冒泡的那一对
//   cancelable: false  → 焦点已经移动完了才发这个事件，取消没有意义。
//                        preventDefault 在这里是空操作
//
// relatedTarget 是「从哪来 / 到哪去」：focus 事件里是上一个焦点，
// blur 事件里是下一个焦点。focus.ts 每次派发都会带上。
export class FocusEvent extends TerminalEvent {
  readonly relatedTarget: EventTarget | null

  constructor(
    type: 'focus' | 'blur',
    relatedTarget: EventTarget | null = null,
  ) {
    super(type, { bubbles: true, cancelable: false })
    this.relatedTarget = relatedTarget
  }
}
