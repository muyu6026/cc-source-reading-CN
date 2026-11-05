import { DEFAULT_BINDINGS } from '../../keybindings/defaultBindings.js'
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js'
import {
  MACOS_RESERVED,
  NON_REBINDABLE,
  TERMINAL_RESERVED,
} from '../../keybindings/reservedShortcuts.js'
import type { KeybindingsSchemaType } from '../../keybindings/schema.js'
import {
  KEYBINDING_ACTIONS,
  KEYBINDING_CONTEXT_DESCRIPTIONS,
  KEYBINDING_CONTEXTS,
} from '../../keybindings/schema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { registerBundledSkill } from '../bundledSkills.js'
// 从默认键位与模式导入构建表格所需的数据，jsonStringify 用来美化范例

// registerBundledSkill 把本文件产出的内容注册成内置技能
// generateContextsTable：生成所有上下文的 Markdown 表格
/**
 * Build a markdown table of all contexts.
 */
function generateContextsTable(): string {
// 用 KEYBINDING_CONTEXTS 与描述拼出一张两列表
  return markdownTable(
    ['Context', 'Description'],
    KEYBINDING_CONTEXTS.map(ctx => [
      `\`${ctx}\``,
      KEYBINDING_CONTEXT_DESCRIPTIONS[ctx],
    ]),
  )
}

/**
 * Build a markdown table of all actions with their default bindings and context.
 */
// generateActionsTable：把每个动作的反查默认键位与所属上下文列成表
function generateActionsTable(): string {
  // Build a lookup: action -> { keys, context }
  const actionInfo: Record<string, { keys: string[]; context: string }> = {}
  for (const block of DEFAULT_BINDINGS) {
// 先遍历默认键位，建出「动作 → 键位 + 上下文」的反查表
    for (const [key, action] of Object.entries(block.bindings)) {
      if (action) {
        if (!actionInfo[action]) {
          actionInfo[action] = { keys: [], context: block.context }
        }
        actionInfo[action].keys.push(key)
      }
    }
  }

  return markdownTable(
// 把动作表映射成带反查结果的 Markdown 三列表
    ['Action', 'Default Key(s)', 'Context'],
    KEYBINDING_ACTIONS.map(action => {
      const info = actionInfo[action]
      const keys = info ? info.keys.map(k => `\`${k}\``).join(', ') : '(none)'
      const context = info ? info.context : inferContextFromAction(action)
      return [`\`${action}\``, keys, context]
    }),
  )
}

/**
 * Infer context from action prefix when not in DEFAULT_BINDINGS.
 */
// inferContextFromAction：动作不在默认表里时，靠冒号前缀猜它属于哪个上下文
function inferContextFromAction(action: string): string {
  const prefix = action.split(':')[0]
// 按冒号前的第一段（如 chat、app）映射到上下文，查不到回 Unknown
  const prefixToContext: Record<string, string> = {
    app: 'Global',
    history: 'Global or Chat',
    chat: 'Chat',
    autocomplete: 'Autocomplete',
    confirm: 'Confirmation',
    tabs: 'Tabs',
    transcript: 'Transcript',
    historySearch: 'HistorySearch',
    task: 'Task',
    theme: 'ThemePicker',
    help: 'Help',
    attachments: 'Attachments',
    footer: 'Footer',
    messageSelector: 'MessageSelector',
    diff: 'DiffDialog',
    modelPicker: 'ModelPicker',
    select: 'Select',
    permission: 'Confirmation',
  }
  return prefixToContext[prefix ?? ''] ?? 'Unknown'
}

/**
 * Build a list of reserved shortcuts.
 */
// generateReservedShortcuts：把三类保留快捷键拼成 Markdown 章节
function generateReservedShortcuts(): string {
  const lines: string[] = []

  lines.push('### Non-rebindable (errors)')
// 先列不可重绑的键，违反会直接报错
  for (const s of NON_REBINDABLE) {
    lines.push(`- \`${s.key}\` — ${s.reason}`)
  }

  lines.push('')
  lines.push('### Terminal reserved (errors/warnings)')
  for (const s of TERMINAL_RESERVED) {
// 再列终端保留键，按严重度区分「不能用」与「可能冲突」
    lines.push(
      `- \`${s.key}\` — ${s.reason} (${s.severity === 'error' ? 'will not work' : 'may conflict'})`,
    )
  }

  lines.push('')
  lines.push('### macOS reserved (errors)')
// 最后列 macOS 保留键，违反也是报错
  for (const s of MACOS_RESERVED) {
    lines.push(`- \`${s.key}\` — ${s.reason}`)
  }

  return lines.join('\n')
}

// FILE_FORMAT_EXAMPLE：写进技能文档的 keybindings.json 范例
const FILE_FORMAT_EXAMPLE: KeybindingsSchemaType = {
  $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
  $docs: 'https://code.claude.com/docs/en/keybindings',
  bindings: [
    {
      context: 'Chat',
      bindings: {
        'ctrl+e': 'chat:externalEditor',
      },
    },
  ],
}

// UNBIND_EXAMPLE：演示把某个键设成 null 来解绑
const UNBIND_EXAMPLE: KeybindingsSchemaType['bindings'][number] = {
  context: 'Chat',
  bindings: {
    'ctrl+s': null,
  },
}

// REBIND_EXAMPLE：演示解绑旧键并加新键
const REBIND_EXAMPLE: KeybindingsSchemaType['bindings'][number] = {
  context: 'Chat',
  bindings: {
    'ctrl+g': null,
    'ctrl+e': 'chat:externalEditor',
  },
}

// CHORD_EXAMPLE：演示和弦绑定 ctrl+k ctrl+t
const CHORD_EXAMPLE: KeybindingsSchemaType['bindings'][number] = {
  context: 'Global',
  bindings: {
    'ctrl+k ctrl+t': 'app:toggleTodos',
  },
}

// SECTION_INTRO：技能文档的开场白，强调先读现有文件再合并
const SECTION_INTRO = [
  '# Keybindings Skill',
  '',
  'Create or modify `~/.claude/keybindings.json` to customize keyboard shortcuts.',
  '',
  '## CRITICAL: Read Before Write',
  '',
  '**Always read `~/.claude/keybindings.json` first** (it may not exist yet). Merge changes with existing bindings — never replace the entire file.',
  '',
  '- Use **Edit** tool for modifications to existing files',
  '- Use **Write** tool only if the file does not exist yet',
].join('\n')

// SECTION_FILE_FORMAT：文件格式章节，含 schema 范例
const SECTION_FILE_FORMAT = [
  '## File Format',
  '',
  '```json',
  jsonStringify(FILE_FORMAT_EXAMPLE, null, 2),
  '```',
  '',
  'Always include the `$schema` and `$docs` fields.',
].join('\n')

// SECTION_KEYSTROKE_SYNTAX：按键语法章节，列修饰键与特殊键
const SECTION_KEYSTROKE_SYNTAX = [
  '## Keystroke Syntax',
  '',
  '**Modifiers** (combine with `+`):',
  '- `ctrl` (alias: `control`)',
  '- `alt` (aliases: `opt`, `option`) — note: `alt` and `meta` are identical in terminals',
  '- `shift`',
  '- `meta` (aliases: `cmd`, `command`)',
  '',
  '**Special keys**: `escape`/`esc`, `enter`/`return`, `tab`, `space`, `backspace`, `delete`, `up`, `down`, `left`, `right`',
  '',
  '**Chords**: Space-separated keystrokes, e.g. `ctrl+k ctrl+s` (1-second timeout between keystrokes)',
  '',
  '**Examples**: `ctrl+shift+p`, `alt+enter`, `ctrl+k ctrl+n`',
].join('\n')

// SECTION_UNBINDING：解绑章节
const SECTION_UNBINDING = [
  '## Unbinding Default Shortcuts',
  '',
  'Set a key to `null` to remove its default binding:',
  '',
  '```json',
  jsonStringify(UNBIND_EXAMPLE, null, 2),
  '```',
].join('\n')

// SECTION_INTERACTION：用户键位如何与默认值叠加
const SECTION_INTERACTION = [
  '## How User Bindings Interact with Defaults',
  '',
  '- User bindings are **additive** — they are appended after the default bindings',
  '- To **move** a binding to a different key: unbind the old key (`null`) AND add the new binding',
  "- A context only needs to appear in the user's file if they want to change something in that context",
].join('\n')

// SECTION_COMMON_PATTERNS：常见模式（重绑、和弦）范例
const SECTION_COMMON_PATTERNS = [
  '## Common Patterns',
  '',
  '### Rebind a key',
  'To change the external editor shortcut from `ctrl+g` to `ctrl+e`:',
  '```json',
  jsonStringify(REBIND_EXAMPLE, null, 2),
  '```',
  '',
  '### Add a chord binding',
  '```json',
  jsonStringify(CHORD_EXAMPLE, null, 2),
  '```',
].join('\n')

// SECTION_BEHAVIORAL_RULES：五条行为规则
const SECTION_BEHAVIORAL_RULES = [
  '## Behavioral Rules',
  '',
  '1. Only include contexts the user wants to change (minimal overrides)',
  '2. Validate that actions and contexts are from the known lists below',
  '3. Warn the user proactively if they choose a key that conflicts with reserved shortcuts or common tools like tmux (`ctrl+b`) and screen (`ctrl+a`)',
  '4. When adding a new binding for an existing action, the new binding is additive (existing default still works unless explicitly unbound)',
  '5. To fully replace a default binding, unbind the old key AND add the new one',
].join('\n')

// SECTION_DOCTOR：用 /doctor 校验时的常见错误与修复章节
const SECTION_DOCTOR = [
  '## Validation with /doctor',
  '',
  'The `/doctor` command includes a "Keybinding Configuration Issues" section that validates `~/.claude/keybindings.json`.',
  '',
  '### Common Issues and Fixes',
  '',
  markdownTable(
    ['Issue', 'Cause', 'Fix'],
    [
      [
        '`keybindings.json must have a "bindings" array`',
        'Missing wrapper object',
        'Wrap bindings in `{ "bindings": [...] }`',
      ],
      [
        '`"bindings" must be an array`',
        '`bindings` is not an array',
        'Set `"bindings"` to an array: `[{ context: ..., bindings: ... }]`',
      ],
      [
        '`Unknown context "X"`',
        'Typo or invalid context name',
        'Use exact context names from the Available Contexts table',
      ],
      [
        '`Duplicate key "X" in Y bindings`',
        'Same key defined twice in one context',
        'Remove the duplicate; JSON uses only the last value',
      ],
      [
        '`"X" may not work: ...`',
        'Key conflicts with terminal/OS reserved shortcut',
        'Choose a different key (see Reserved Shortcuts section)',
      ],
      [
        '`Could not parse keystroke "X"`',
        'Invalid key syntax',
        'Check syntax: use `+` between modifiers, valid key names',
      ],
      [
        '`Invalid action for "X"`',
        'Action value is not a string or null',
        'Actions must be strings like `"app:help"` or `null` to unbind',
      ],
    ],
  ),
  '',
  '### Example /doctor Output',
  '',
  '```',
  'Keybinding Configuration Issues',
  'Location: ~/.claude/keybindings.json',
  '  └ [Error] Unknown context "chat"',
  '    → Valid contexts: Global, Chat, Autocomplete, ...',
  '  └ [Warning] "ctrl+c" may not work: Terminal interrupt (SIGINT)',
  '```',
  '',
  '**Errors** prevent bindings from working and must be fixed. **Warnings** indicate potential conflicts but the binding may still work.',
].join('\n')

// registerKeybindingsSkill：把上面所有章节注册成一个内置技能
export function registerKeybindingsSkill(): void {
  registerBundledSkill({
// 技能只给 Read 工具，且不让用户直接调用，由系统按场景触发
    name: 'keybindings-help',
    description:
      'Use when the user wants to customize keyboard shortcuts, rebind keys, add chord bindings, or modify ~/.claude/keybindings.json. Examples: "rebind ctrl+s", "add a chord shortcut", "change the submit key", "customize keybindings".',
    allowedTools: ['Read'],
    userInvocable: false,
    isEnabled: isKeybindingCustomizationEnabled,
    async getPromptForCommand(args) {
// getPromptForCommand：按需从真相源数组动态生成参考表，而不是写死
      // Generate reference tables dynamically from source-of-truth arrays
      const contextsTable = generateContextsTable()
      const actionsTable = generateActionsTable()
      const reservedShortcuts = generateReservedShortcuts()

      const sections = [
// 把所有章节按顺序拼起来，用户额外请求附在最后
        SECTION_INTRO,
        SECTION_FILE_FORMAT,
        SECTION_KEYSTROKE_SYNTAX,
        SECTION_UNBINDING,
        SECTION_INTERACTION,
        SECTION_COMMON_PATTERNS,
        SECTION_BEHAVIORAL_RULES,
        SECTION_DOCTOR,
        `## Reserved Shortcuts\n\n${reservedShortcuts}`,
        `## Available Contexts\n\n${contextsTable}`,
        `## Available Actions\n\n${actionsTable}`,
      ]

      if (args) {
        sections.push(`## User Request\n\n${args}`)
      }

      return [{ type: 'text', text: sections.join('\n\n') }]
    },
// getPromptForCommand 收尾：返回一段文本，供技能调用方取用
  })
}

/**
 * Build a markdown table from headers and rows.
 */
// markdownTable：把表头与行拼成 Markdown 表格的辅助函数
function markdownTable(headers: string[], rows: string[][]): string {
  const separator = headers.map(() => '---')
// 分隔行每个表头都来一条 ---，保证渲染器识别成表格
  return [
    `| ${headers.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}
// keybindings 技能文件收尾：导出注册函数，所有章节已就绪
