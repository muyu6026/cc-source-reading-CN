/**
 * This testing-only tool will always pop up a permission dialog when called by
 * the model.
 */
// 文件头注释即用途：这是个测试专用工具，唯一职责是被模型调用时弹一次权限对话框。
import { z } from 'zod/v4';
import type { Tool } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
const NAME = 'TestingPermission';
// NAME 与 inputSchema：空 strictObject，调用不带任何参数。
const inputSchema = lazySchema(() => z.strictObject({}));
type InputSchema = ReturnType<typeof inputSchema>;
export const TestingPermissionTool: Tool<InputSchema, string> = buildTool({
  name: NAME,
  maxResultSizeChars: 100_000,
  async description() {
    return 'Test tool that always asks for permission';
  },
  async prompt() {
    return 'Test tool that always asks for permission before executing. Used for end-to-end testing.';
// description/prompt 两句都明说 always asks——测试框架靠它验证权限链路。
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  userFacingName() {
    return 'TestingPermission';
  },
  isEnabled() {
    return "production" === 'test';
// 同样一处恒假条件 "production" === 'test'：疑似泄漏构建的环境替换事故，isEnabled 实际恒 false，只在测试构建里才为真。
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  async checkPermissions() {
// checkPermissions 恒 ask：这就是「测试钉子」——正常工具会分级（allow/ask/deny），它永远只走 ask，方便端到端测试权限弹窗的全链路。
    // This tool always requires permission
    return {
      behavior: 'ask' as const,
      message: `Run test?`
    };
  },
  renderToolUseMessage() {
    return null;
  },
  renderToolUseProgressMessage() {
    return null;
  },
  renderToolUseQueuedMessage() {
    return null;
  },
  renderToolUseRejectedMessage() {
    return null;
  },
  renderToolResultMessage() {
    return null;
  },
  renderToolUseErrorMessage() {
    return null;
  },
  async call() {
    return {
      data: `${NAME} executed successfully`
    };
// call 只是回一句执行成功——工具本身不做事，存在意义全在权限交互上。
  },
  mapToolResultToToolResultBlockParam(result, toolUseID) {
    return {
      type: 'tool_result',
      content: String(result),
// mapToolResultToToolResultBlockParam 用 String(result) 兜底转字符串。
      tool_use_id: toolUseID
    };
  }
} satisfies ToolDef<InputSchema, string>);
// 原文件此处有一行 5504 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。