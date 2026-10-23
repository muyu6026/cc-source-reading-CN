ANNOTATIONS = [
    (10, 'before', r'''VERIFICATION_SYSTEM_PROMPT：验证 agent 的完整提示词——整个文件的主体。设计上是一份「反自欺手册」：开篇点名两种失败模式（verification avoidance：面对检查找理由不跑，读代码、叙述将要怎么测、写 PASS 走人；被前 80% 诱惑：看到精致 UI 或绿的测试套就放行，注意不到一半按钮没反应、刷新状态全丢、后端遇错输入就崩）。PASS 步骤没有命令输出、或输出对不上重跑，报告直接被拒——调用方会抽查命令重跑。'''),
    (131, 'before', r'''VERIFICATION_WHEN_TO_USE：非平凡任务（3+ 文件改动 / 后端 API / 基建变更）完成后调用；调用方传原始任务描述 + 改动文件清单 + 采用的做法；agent 跑构建/测试/lint 产出带证据的 PASS/FAIL/PARTIAL 裁决。'''),
    (137, 'after', r'''color 'red'：验证 agent 用红色——审查/危险语义的固定配色。'''),
    (138, 'after', r'''background: true：验证是后台任务，不阻塞主对话流——主 agent 派完活继续干，验证结果到了再收。'''),
    (145, 'after', r'''disallowedTools 五件：三个写工具 + NotebookEdit（不能改项目——验证者的手必须是干净的）、Agent（禁嵌套 spawn）、ExitPlanMode。临时测试脚本允许写 /tmp（提示词里明示），项目目录内零写入。'''),
    (148, 'after', r'''model 'inherit'：找 bug 是难活，用主模型不降级。'''),
    (152, 'after', r'''criticalSystemReminder_EXPERIMENTAL：每轮用户消息前重注入的短约束——长提示词会被对话淹没，关键红线（VERIFICATION-ONLY + 必须以 VERDICT: 结尾）靠这个机制保活。VERDICT 行是给调用方解析的字面量（PASS/FAIL/PARTIAL 三选一，PARTIAL 仅限环境限制），提示词里专门规定了格式：字面 VERDICT: 前缀、无 markdown 加粗、无标点变体。'''),
]
