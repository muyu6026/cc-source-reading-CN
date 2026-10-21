// ═══════════════════════════════════════════════════════════════
//  nullRenderingAttachments：一张「渲染出来什么都没有」的类型清单
// ═══════════════════════════════════════════════════════════════
//
//  这个文件只有 70 行，却解决了一个很具体的问题：
//
//    Messages.tsx 只渲染最近 200 条消息。如果这 200 条里塞满了
//    hook_success / todo_reminder / date_change 这类「界面上根本看不见」
//    的 attachment，用户会觉得「怎么滚两下就到头了」。
//
//  所以要在**计数之前**把它们滤掉。而「哪些类型看不见」这件事，
//  真相在 AttachmentMessage.tsx 的 switch 里 —— 那些返回 null 的分支。
//
//  两个文件必须一致，但它们是两个文件。这就是这个模块的全部意义：
//  把「一致性」交给 TypeScript 去强迫（见第 49 行）。
import type { Attachment } from 'src/utils/attachments.js'
import type { Message, NormalizedMessage } from '../../types/message.js'

// 【注释里带了一个工单号 CC-724，这是本仓库的惯例】
//
//  读这份代码会反复看到形如 CC-724 / CC-941 / CC-1154 / CC-1174 的编号。
//  它们是内部 issue 号，作用是：**让后来的人能查到「为什么当初要这么做」**。
//  在开源仓库里这些编号查不到，但注释本身通常已经把原因写全了，
//  编号只是给内部读者留的索引。
//
//  这里的原因写得非常直白：invisible entries don't consume the render budget。
//  一句话说清了「为什么要在计数前滤」而不是「在渲染时返回 null」。
/**
 * Attachment types that AttachmentMessage renders as `null` unconditionally
 * (no visible output regardless of runtime state). Messages.tsx filters these
 * out BEFORE the render cap / message count so invisible entries don't consume
 * the 200-message render budget (CC-724).
 *
 * Sync is enforced by TypeScript: AttachmentMessage's switch `default:` branch
 * asserts `attachment.type satisfies NullRenderingAttachmentType`. Adding a new
 * Attachment type without either a case or an entry here will fail typecheck.
 */
// 【「Sync is enforced by TypeScript」—— 这句话说的是第 49 行】
//
//  先看这句承诺，再看相邻的 AttachmentMessage.tsx。第 49 行的 `satisfies readonly Attachment['type'][]`
//  只保证「这里写的每个字符串都是合法的 attachment 类型」，
//  它**反过来不保证**「每个 attachment 类型都在这里或 switch 里出现过」。
//
//  真正的双向保证在另一半：AttachmentMessage.tsx 的 default 分支里有一行
//
//      attachment.type satisfies NullRenderingAttachmentType | 'skill_discovery' | 'teammate_mailbox'
//
//  只有两处同时成立，新增一个 attachment 类型才会 typecheck 失败。
//  换句话说：**这份承诺不是一个文件能兑现的，它是一对文件合起来的性质。**
//  读到「由 X 保证」这类注释时，最好去 X 那里确认它到底保证了哪一半。
//
// 【三十四个类型，按字母序。这个顺序没有语义，只是为了好找】
//
//  粗略分几类：
//    · hook 生命周期   hook_success / hook_cancelled
//    · 模式切换        plan_mode / plan_mode_exit / plan_mode_reentry / auto_mode / ...
//    · 令牌与预算      token_usage / output_token_usage / budget_usd
//    · 上下文管理      critical_system_reminder / todo_reminder / compaction_reminder
//    · 编辑器联动      edited_image_file / edited_text_file / opened_file_in_ide
//
//  它们共同的特征：**对模型有意义，对用户没意义**。
//  模型需要知道「用户刚把 plan 模式切走了」，但屏幕上多一行
//  「plan_mode_exit」只会让人困惑。
//
//  这就是「同一份数据，两个读者」的典型场景：渲染层要按读者裁掉一半内容，
//  而裁剪规则必须写在一处、并且可被编译器检查。
const NULL_RENDERING_TYPES = [
  'hook_success',
  'hook_additional_context',
  'hook_cancelled',
  'command_permissions',
  'agent_mention',
  'budget_usd',
  'critical_system_reminder',
  'edited_image_file',
  'edited_text_file',
  'opened_file_in_ide',
  'output_style',
  'plan_mode',
  'plan_mode_exit',
  'plan_mode_reentry',
  'structured_output',
  'team_context',
  'todo_reminder',
  'context_efficiency',
  'deferred_tools_delta',
  'mcp_instructions_delta',
  'companion_intro',
  'token_usage',
  'ultrathink_effort',
  'max_turns_reached',
  'task_reminder',
  'auto_mode',
  'auto_mode_exit',
  'output_token_usage',
  'pen_mode_enter',
  'pen_mode_exit',
  'verify_plan_reminder',
  'current_session_memory',
  'compaction_reminder',
  'date_change',
] as const satisfies readonly Attachment['type'][]
//  ↑ `as const` 把数组变成元组（每个元素是字面量类型而不是 string）；
//    `satisfies readonly Attachment['type'][]` 再检查「每个元素都是合法的类型名」。
//
//    为什么用 satisfies 而不是 `: readonly Attachment['type'][]` 注解？
//    因为注解会把类型**拓宽**成 string 联合数组，第 51 行就从元组退化了 ——
//    `(typeof NULL_RENDERING_TYPES)[number]` 会变成整个 union，
//    「只能传这 35 个字面量」的约束就没了。
//
//    satisfies 的用处正是在这里：**检查但不改变推断出来的类型**。

export type NullRenderingAttachmentType = (typeof NULL_RENDERING_TYPES)[number]

// 【数组要用两次，第二次要 O(1) 查找，所以包成 Set】
//
//  注意它是模块级常量，不是每次渲染 new 一个。
//  Set 的创建要遍历 35 个字符串 —— 放在组件里就是每帧一次，
//  而 isNullRenderingAttachment 在 Messages.tsx 里对**每条消息**调用一次。
//
//  这类「模块级常量 Set」在本仓库出现过好几次（EMPTY_SET / NO_OP_SUBSCRIBE），
//  理由都一样：**引用稳定 + 只算一次**。React 的 memo 比较看的是引用，
//  每次 new Set() 都会让下游 memo 全部失效。
const NULL_RENDERING_ATTACHMENT_TYPES: ReadonlySet<Attachment['type']> =
  new Set(NULL_RENDERING_TYPES)

/**
 * True when this message is an attachment that AttachmentMessage renders as
 * null with no visible output. Messages.tsx filters these out before counting
 * and before applying the 200-message render cap, so invisible hook
 * attachments (hook_success, hook_additional_context, hook_cancelled) don't
 * inflate the "N messages" count or eat into the render budget (CC-724).
 */
// 【签名接受 Message | NormalizedMessage 两种入参】
//
//  因为调用方有两处，拿到的形状不一样：
//    · Messages.tsx 拿的是归一化之后的 NormalizedMessage
//    · 其他路径可能直接拿到原始 Message
//
//  两者都有 type 和 attachment 字段，所以这里只做结构判断，
//  不需要 instanceof 也不需要类型守卫函数。
//
//  这种「鸭子类型 + 联合参数」在本仓库很常见，
//  代价是签名变宽，收益是不用为两种形状写两份实现。
export function isNullRenderingAttachment(
  msg: Message | NormalizedMessage,
): boolean {
// 【两行判断，顺序不能换】
//
//  先判 type === 'attachment'，再判 attachment.type 在不在表里。
//  反过来的话，非 attachment 的消息会去访问 .attachment 属性 —— 那是 undefined，
//  .type 就会抛 TypeError。
//
//  短路求值在这里不是「性能优化」，是**正确性依赖**。
  return (
    msg.type === 'attachment' &&
    NULL_RENDERING_ATTACHMENT_TYPES.has(msg.attachment.type)
  )
}
