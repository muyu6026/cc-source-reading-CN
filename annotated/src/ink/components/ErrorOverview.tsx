import codeExcerpt, { type CodeExcerpt } from 'code-excerpt';
import { readFileSync } from 'fs';
import React from 'react';
import StackUtils from 'stack-utils';
import Box from './Box.js';
import Text from './Text.js';

/* eslint-disable custom-rules/no-process-cwd -- stack trace file:// paths are relative to the real OS cwd, not the virtual cwd */

// Error's source file is reported as file:///home/user/file.js
// This function removes the file://[cwd] part
const cleanupPath = (path: string | undefined): string | undefined => {
  return path?.replace(`file://${process.cwd()}/`, '');
};
let stackUtils: StackUtils | undefined;
function getStackUtils(): StackUtils {
  return stackUtils ??= new StackUtils({
    cwd: process.cwd(),
    internals: StackUtils.nodeInternals()
  });
}

/* eslint-enable custom-rules/no-process-cwd */

type Props = {
  readonly error: Error;
};
// 渲染错误界面的组件，本身必须是**绝不会失败**的 —— 所以它只用了
// Box / Text 两个最基础的东西，没有任何状态、没有 effect。
//
// 三块内容：错误消息、出错的那行源码、调用栈。下面按这三块标。
export default function ErrorOverview({
  error
}: Props) {
  const stack = error.stack ? error.stack.split('\n').slice(1) : undefined;
  const origin = stack ? getStackUtils().parseLine(stack[0]!) : undefined;
  const filePath = cleanupPath(origin?.file);
  let excerpt: CodeExcerpt[] | undefined;
  let lineWidth = 0;
  if (filePath && origin?.line) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- sync render path; error overlay can't go async without suspense restructuring
      const sourceCode = readFileSync(filePath, 'utf8');
      excerpt = codeExcerpt(sourceCode, origin.line);
      if (excerpt) {
        for (const {
          line
        } of excerpt) {
          lineWidth = Math.max(lineWidth, String(line).length);
        }
      }
    } catch {
      // file not readable — skip source context
    }
  }
// 【在 render 里同步读文件】
//
// 注释里给了理由："error overlay can't go async without suspense
// restructuring" —— 要异步就得用 Suspense 包起来，而 Suspense 的
// fallback 会先渲染一次空界面，错误界面闪一下反而更糟。
//
// 这一整段被 try 包住，读失败就跳过源码上下文（不显示而已）。
// 这也是错误界面的通则：**它显示的信息不全，远好过它自己崩掉**。
  return <Box flexDirection="column" padding={1}>
      <Box>
        <Text backgroundColor="ansi:red" color="ansi:white">
          {' '}
          ERROR{' '}
        </Text>

        <Text> {error.message}</Text>
      </Box>
// 第一行：红色底的 ERROR 徽章 + 消息。
//
// `{' '}` 包在 ERROR 两侧不是排版洁癖：背景色只铺在**有字符的格子**上，
// 所以 ` ERROR ` 里的两个空格必须是真的字符，否则红色块会紧贴字母。
//
// 下面两处 `backgroundColor={cond ? 'ansi:red' : undefined}` 显式传
// undefined 而不是省略 —— 这是内联对象字面量，省略键和传 undefined
// 在 diff 里最终等价（reconciler 会把「键消失」表达成 {key: undefined}），
// 显式写出来只是让「这一行有底色、其他行没有」这件事一眼可见。

      {origin && filePath && <Box marginTop={1}>
          <Text dim>
            {filePath}:{origin.line}:{origin.column}
          </Text>
        </Box>}

      {origin && excerpt && <Box marginTop={1} flexDirection="column">
          {excerpt.map(({
        line: line_0,
        value
      }) => <Box key={line_0}>
              <Box width={lineWidth + 1}>
                <Text dim={line_0 !== origin.line} backgroundColor={line_0 === origin.line ? 'ansi:red' : undefined} color={line_0 === origin.line ? 'ansi:white' : undefined}>
                  {String(line_0).padStart(lineWidth, ' ')}:
                </Text>
              </Box>

              <Text key={line_0} backgroundColor={line_0 === origin.line ? 'ansi:red' : undefined} color={line_0 === origin.line ? 'ansi:white' : undefined}>
                {' ' + value}
              </Text>
            </Box>)}
        </Box>}

      {error.stack && <Box marginTop={1} flexDirection="column">
          {error.stack.split('\n').slice(1).map(line_1 => {
        const parsedLine = getStackUtils().parseLine(line_1);

        // If the line from the stack cannot be parsed, we print out the unparsed line.
        if (!parsedLine) {
          return <Box key={line_1}>
                    <Text dim>- </Text>
                    <Text bold>{line_1}</Text>
                  </Box>;
        }
        return <Box key={line_1}>
                  <Text dim>- </Text>
                  <Text bold>{parsedLine.function}</Text>
                  <Text dim>
                    {' '}
                    ({cleanupPath(parsedLine.file) ?? ''}:{parsedLine.line}:
                    {parsedLine.column})
                  </Text>
                </Box>;
      })}
        </Box>}
    </Box>;
}
// 原文件此处有一行 11692 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。