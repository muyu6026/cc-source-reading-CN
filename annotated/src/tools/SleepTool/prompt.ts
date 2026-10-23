import { TICK_TAG } from '../../constants/xml.js'

export const SLEEP_TOOL_NAME = 'Sleep'

export const DESCRIPTION = 'Wait for a specified duration'
// DESCRIPTION 一句话：等待指定时长。

// SLEEP_TOOL_PROMPT 大模板字符串（模型操作手册）。内部是纯文案，逐行锚点会被模板字符串保护机制外移到段尾。
export const SLEEP_TOOL_PROMPT = `Wait for a specified duration. The user can interrupt the sleep at any time.

Use this when the user tells you to sleep or rest, when you have nothing to do, or when you're waiting for something.

You may receive <${TICK_TAG}> prompts — these are periodic check-ins. Look for useful work to do before sleeping.

You can call this concurrently with other tools — it won't interfere with them.

Prefer this over \`Bash(sleep ...)\` — it doesn't hold a shell process.

Each wake-up costs an API call, but the prompt cache expires after 5 minutes of inactivity — balance accordingly.`
// TICK_TAG 插值：周期签到提示的 XML 标签名从 constants/xml.js 引入，不硬编码——两处必须一致，否则模型的签到提示认不出来。
// 「可与其他工具并发」：sleep 不占 shell 进程，这是它相对 Bash(sleep ...) 的核心优势。
// 代价说明写在 prompt 里：每次唤醒花一次 API 调用，而提示缓存 5 分钟不活动就过期——让模型自己权衡睡多久。
