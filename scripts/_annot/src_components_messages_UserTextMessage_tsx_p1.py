# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  UserTextMessage：用户那一侧的总分发器（十七个 if，顺序即协议）
// ═══════════════════════════════════════════════════════════════
//
//  上一批读过 Message.tsx 的外层 switch：按 message.type 分发。
//  这一层的输入是 `param.text` —— 一段**字符串**。于是它只能靠
//  「这段文本里有什么标签 / 以什么开头」来判断该交给谁。
//
//  十七个判断，从上到下：
//
//      1   text 就是 NO_CONTENT_MESSAGE 占位           → 不画
//      2   planContent 存在                             → UserPlanMessage
//      3   带 tick 标签                                 → 不画
//      4   带 local-command-caveat                      → 不画
//      5   bash-stdout / bash-stderr 开头               → UserBashOutputMessage
//      6   local-command-stdout / stderr 开头           → UserLocalCommandOutputMessage
//      7   正好等于两条中断文案                         → InterruptedByUser
//      8   github-webhook-activity 开头（feature 门控） → 懒加载
//      9   含 bash-input                                → UserBashInputMessage
//     10   含 command-message                          → UserCommandMessage
//     11   含 user-memory-input                        → UserMemoryInputMessage
//     12   含 teammate-message（运行时门控）           → UserTeammateMessage
//     13   含 task-notification                        → UserAgentNotificationMessage
//     14   含 mcp-resource-update / mcp-polling-update  → UserResourceUpdateMessage
//     15   含 fork-boilerplate（feature 门控）         → 懒加载
//     16   含 cross-session-message（feature 门控）    → 懒加载
//     17   含 channel source=（feature 门控）          → 懒加载
//     最后 兜底                                        → UserPromptMessage
//
//  ⚠️ **顺序不是随便排的。** 见第 54 行那条批注：
//  把「不画」的判断放在「画」的前面，是为了让空内容的判定优先于
//  「这段文本里碰巧包含某个标签」。
//
//  这一批读完应该形成一个直觉：
//  **终端里的「消息类型」不是数据字段，是文本里的标记。**
//  所以分发逻辑只能是「按顺序试探标签」，而不可能是 O(1) 的查表。'''),

    (39, 'before', '''// 【第一条判断：`param.text.trim() === NO_CONTENT_MESSAGE`】
//
//  用 trim() 再比，是因为上游可能给文本加了换行/空格。
//  这个常量（大概是「(no content)」这类占位）会出现在
//  工具结果为空、或者用户只贴了图没打字的时候。
//
//  放在所有判断之前，是为了不让它被后面的 includes 判断截走 ——
//  虽然它本身不含任何标签，但顺序仍然应该体现「先处理最特殊的」。'''),

    (42, 'before', '''// 【planContent 优先于一切标签判断】
//
//  只要调用方给了 planContent（说明这条消息是用户提交的计划），
//  就直接走 UserPlanMessage，**不再看文本里有什么**。
//
//  为什么？因为计划正文里可能包含任意内容 ——
//  用户可以让模型在计划里写一段 XML 示例，那里面可能有 <bash-input>。
//  如果不先短路，这段计划会被误判成 bash 输入。
//
//  **这是一条对抗性输入的防御**：只要有一个「高优先级、内容随意」的字段，
//  它必须排在所有内容匹配之前。'''),

    (54, 'before', '''// 【第 54、57 两行：两条「不画」的判断】
//
//      extractTag(param.text, TICK_TAG)                  单条勾选标记
//      includes('<local-command-caveat>')                本地命令的说明注
//
//  第二条用的是 includes 而不是 extractTag —— 因为只需要知道「有没有」，
//  不需要取出内容。而需要取内容的那几处（第 39 行之后）才用 extractTag。
//
//  `includes` 是 O(n) 的子串查找，`extractTag` 是正则 + 捕获。
//  十七个判断里有九个是 includes，只有两个是 extractTag，
//  这个配比是为了让「不是我的」这条快路径足够便宜 ——
//  绝大多数消息会一路走到最后的 UserPromptMessage，
//  中途每个判断都在做全串扫描。'''),

    (93, 'before', '''// 【三个 require 懒加载，藏在 feature() 门控里面】
//
//      if (feature('KAIROS_GITHUB_WEBHOOKS')) {
//        if (param.text.startsWith('<github-webhook-activity>')) {
//          const { UserGitHubWebhookMessage } = require('./UserGitHubWebhookMessage.js')
//
//  两个细节：
//
//  一、`feature()` 是编译期常量，外部构建里整个 if 块消失，
//      **连 require 都不存在**。那个文件也就不进包。
//
//  二、为什么不用顶部静态 import？因为静态 import 会在模块图里留一条边，
//      即使代码被 DCE 掉，那一次模块求值也可能保留（取决于打包器的副作用分析）。
//      `require` 放在运行期分支里，是让 DCE 能干净地删掉它的最可靠写法。
//
//  代价：`require` 的结果被塞进 sentinel 槽（第 97 行）——
//  Compiler 不知道它是常量，于是保守地缓存起来。实际上它确实只求值一次。'''),

    (117, 'before', '''// 【注意第 117 行用的是 `includes('<bash-input>')`，而不是 startsWith】
//
//  因为一条用户消息里，bash 输入可能不是开头 ——
//  用户可以先打一句话，再在同一轮里跑一个 ! 命令。
//
//  而第 60 行判断 bash **输出**时用的是 startsWith：
//  因为输出整条就是由包装器生成的，不会混在别的内容里。
//
//  这个区别不是随意的，它反映了**这两类数据的生产方式不同**：
//      输入  用户手打的，可以混在任何位置
//      输出  程序生成的，整条就是它
//
//  读这类分发器时，逐个问一句「这个标记会不会出现在句中」，
//  就能理解为什么有的用 startsWith、有的用 includes。'''),

    (153, 'before', '''// 【teammate 那条判断多了 `isAgentSwarmsEnabled() &&`】
//
//  和 feature() 不同，isAgentSwarmsEnabled() 是**运行时**判断
//  （取决于配置/环境），所以它不能靠打包期折叠消失。
//
//  于是这行是 `运行时判断 && 字符串匹配` 短路：
//  没开 agent swarms 的用户，连 includes 都不跑。
//
//  这也意味着 `<teammate-message` 这个字符串在外部构建里仍然存在 ——
//  它是可见的。相比之下，feature 门控的那四个（github / fork /
//  cross-session / channel）在外部构建里连字符串都不剩。
//
//  **两种门控的差别，本质是「编译期能不能确定」。**'''),

    (262, 'before', '''// 【兜底：UserPromptMessage，也就是「普通用户输入」】
//
//  十七个判断全部落空 → 那就是用户真的在说话。
//
//  注意这里传了 isTranscriptMode 和 timestamp —— 因为 brief 模式下
//  要在消息头上显示时间。其它分支都没有这两个 prop，
//  因为它们显示的不是「人说的话」，不需要时间戳。
//
//  **兜底分支的参数最全**，是因为它承担了最常见的场景。'''),
]
