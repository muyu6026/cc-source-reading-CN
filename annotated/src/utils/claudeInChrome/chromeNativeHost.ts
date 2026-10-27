// biome-ignore-all lint/suspicious/noConsole: file uses console intentionally
// 本模块是 Chrome 原生消息宿主的纯 TypeScript 实现（原 Rust NAPI 绑定）：通过标准输入输出与 Chrome 通信，并提供基于 Unix 套接字/MCP 客户端的转发层，把 Chrome 的 ping/get_status/tool_response/notification 等消息路由到 MCP 客户端。
/**
 * Chrome Native Host - Pure TypeScript Implementation
 *
 * This module provides the Chrome native messaging host functionality,
 * previously implemented as a Rust NAPI binding but now in pure TypeScript.
 */

import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  rmdir,
  stat,
  unlink,
} from 'fs/promises'
import { createServer, type Server, type Socket } from 'net'
import { homedir, platform } from 'os'
import { join } from 'path'
import { z } from 'zod'
import { lazySchema } from '../lazySchema.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getSecureSocketPath, getSocketDir } from './common.js'

const VERSION = '1.0.0'
const MAX_MESSAGE_SIZE = 1024 * 1024 // 1MB - Max message size that can be sent to Chrome
// 版本常量与单条消息最大尺寸（1MB）。

const LOG_FILE =
  process.env.USER_TYPE === 'ant'
    ? join(homedir(), '.claude', 'debug', 'chrome-native-host.txt')
    : undefined
// ant 用户的调试日志文件路径，其余为 undefined。

// 日志函数：ant 用户追加到文件（尽力而为、不 await），同时始终输出到 stderr。
function log(message: string, ...args: unknown[]): void {
  if (LOG_FILE) {
    const timestamp = new Date().toISOString()
    const formattedArgs = args.length > 0 ? ' ' + jsonStringify(args) : ''
    const logLine = `[${timestamp}] [Claude Chrome Native Host] ${message}${formattedArgs}\n`
    // Fire-and-forget: logging is best-effort and callers (including event
    // handlers) don't await
    void appendFile(LOG_FILE, logLine).catch(() => {
      // Ignore file write errors
    })
  }
  console.error(`[Claude Chrome Native Host] ${message}`, ...args)
}
// 函数收尾：始终写入 stderr。
/**
 * Send a message to stdout (Chrome native messaging protocol)
 */
// 按 Chrome 原生消息协议把消息写到 stdout：先写 4 字节小端长度前缀，再写 UTF-8 JSON 负载。
export function sendChromeMessage(message: string): void {
  const jsonBytes = Buffer.from(message, 'utf-8')
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32LE(jsonBytes.length, 0)

  process.stdout.write(lengthBuffer)
  process.stdout.write(jsonBytes)
}
// 函数收尾：完成长度前缀与负载的写入。

// 宿主主循环：启动服务器，循环从 stdin 读取消息并交由 host 处理，直到 stdin 关闭后停止服务器。
export async function runChromeNativeHost(): Promise<void> {
  log('Initializing...')

  const host = new ChromeNativeHost()
  const messageReader = new ChromeMessageReader()

  // Start the native host server
  await host.start()

  // Process messages from Chrome until stdin closes
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const message = await messageReader.read()
    if (message === null) {
      // stdin closed, Chrome disconnected
      break
    }

    await host.handleMessage(message)
  }

  // Stop the server
  await host.stop()
}
// 函数收尾：stdin 关闭后停止服务器。

const messageSchema = lazySchema(() =>
  z
    .object({
      type: z.string(),
    })
    .passthrough(),
)
// 消息 schema：要求含 type 字段，其余字段透传。

type ToolRequest = {
  method: string
  params?: unknown
}
// 工具请求类型：方法名与可选参数。

type McpClient = {
  id: number
  socket: Socket
  buffer: Buffer
}
// MCP 客户端类型：id、套接字与接收缓冲区。

// Chrome 原生宿主类：管理 MCP 客户端集合、Unix 套接字服务器与消息路由。
class ChromeNativeHost {
  private mcpClients = new Map<number, McpClient>()
  private nextClientId = 1
  private server: Server | null = null
  private running = false
  private socketPath: string | null = null

// 启动服务器：解析安全套接字路径，在非 Windows 上创建权限 0700 的套接字目录并清理过期套接字（按 pid 探活），监听后立即把套接字权限设为 0600。
  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.socketPath = getSecureSocketPath()

    if (platform() !== 'win32') {
      const socketDir = getSocketDir()

      // Migrate legacy socket: if socket dir path exists as a file/socket, remove it
      try {
        const dirStats = await stat(socketDir)
        if (!dirStats.isDirectory()) {
          await unlink(socketDir)
        }
      } catch {
        // Doesn't exist, that's fine
      }

      // Create socket directory with secure permissions
      await mkdir(socketDir, { recursive: true, mode: 0o700 })

      // Fix perms if directory already existed
      await chmod(socketDir, 0o700).catch(() => {
        // Ignore
      })

      // Clean up stale sockets
      try {
        const files = await readdir(socketDir)
        for (const file of files) {
          if (!file.endsWith('.sock')) {
            continue
          }
          const pid = parseInt(file.replace('.sock', ''), 10)
          if (isNaN(pid)) {
            continue
          }
          try {
            process.kill(pid, 0)
            // Process is alive, leave it
          } catch {
            // Process is dead, remove stale socket
            await unlink(join(socketDir, file)).catch(() => {
              // Ignore
            })
            log(`Removed stale socket for PID ${pid}`)
          }
        }
      } catch {
        // Ignore errors scanning directory
      }
    }

    log(`Creating socket listener: ${this.socketPath}`)

    this.server = createServer(socket => this.handleMcpClient(socket))

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.socketPath!, () => {
        log('Socket server listening for connections')
        this.running = true
        resolve()
      })

      this.server!.on('error', err => {
        log('Socket server error:', err)
        reject(err)
      })
    })

    // Set permissions on Unix (after listen resolves so socket file exists)
    if (platform() !== 'win32') {
      try {
        await chmod(this.socketPath!, 0o600)
        log('Socket permissions set to 0600')
      } catch (e) {
        log('Failed to set socket permissions:', e)
      }
    }
  }
// 方法收尾：监听成功后设置权限。

// 停止服务器：销毁所有 MCP 客户端、关闭监听、删除套接字文件与空目录。
  async stop(): Promise<void> {
    if (!this.running) {
      return
    }

    // Close all MCP clients
    for (const [, client] of this.mcpClients) {
      client.socket.destroy()
    }
    this.mcpClients.clear()

    // Close server
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve())
      })
      this.server = null
    }

    // Cleanup socket file
    if (platform() !== 'win32' && this.socketPath) {
      try {
        await unlink(this.socketPath)
        log('Cleaned up socket file')
      } catch {
        // ENOENT is fine, ignore
      }

      // Remove directory if empty
      try {
        const socketDir = getSocketDir()
        const remaining = await readdir(socketDir)
        if (remaining.length === 0) {
          await rmdir(socketDir)
          log('Removed empty socket directory')
        }
      } catch {
        // Ignore
      }
    }

    this.running = false
  }
// 方法收尾：清理套接字与目录。

  async isRunning(): Promise<boolean> {
// 返回服务器是否运行中。
    return this.running
  }

  async getClientCount(): Promise<number> {
// 返回当前 MCP 客户端数量。
    return this.mcpClients.size
  }

// 处理来自 Chrome 的消息：先解析 JSON 与 schema，再按类型响应 ping/get_status，并把 tool_response 与 notification 转发给所有 MCP 客户端，未知类型返回错误。
  async handleMessage(messageJson: string): Promise<void> {
    let rawMessage: unknown
    try {
      rawMessage = jsonParse(messageJson)
    } catch (e) {
      log('Invalid JSON from Chrome:', (e as Error).message)
      sendChromeMessage(
        jsonStringify({
          type: 'error',
          error: 'Invalid message format',
        }),
      )
      return
    }
    const parsed = messageSchema().safeParse(rawMessage)
    if (!parsed.success) {
      log('Invalid message from Chrome:', parsed.error.message)
      sendChromeMessage(
        jsonStringify({
          type: 'error',
          error: 'Invalid message format',
        }),
      )
      return
    }
    const message = parsed.data

    log(`Handling Chrome message type: ${message.type}`)

    switch (message.type) {
      case 'ping':
        log('Responding to ping')

        sendChromeMessage(
          jsonStringify({
            type: 'pong',
            timestamp: Date.now(),
          }),
        )
        break

      case 'get_status':
        sendChromeMessage(
          jsonStringify({
            type: 'status_response',
            native_host_version: VERSION,
          }),
        )
        break

      case 'tool_response': {
        if (this.mcpClients.size > 0) {
          log(`Forwarding tool response to ${this.mcpClients.size} MCP clients`)

          // Extract the data portion (everything except 'type')
          const { type: _, ...data } = message
          const responseData = Buffer.from(jsonStringify(data), 'utf-8')
          const lengthBuffer = Buffer.alloc(4)
          lengthBuffer.writeUInt32LE(responseData.length, 0)
          const responseMsg = Buffer.concat([lengthBuffer, responseData])

          for (const [id, client] of this.mcpClients) {
            try {
              client.socket.write(responseMsg)
            } catch (e) {
              log(`Failed to send to MCP client ${id}:`, e)
            }
          }
        }
        break
      }

      case 'notification': {
        if (this.mcpClients.size > 0) {
          log(`Forwarding notification to ${this.mcpClients.size} MCP clients`)

          // Extract the data portion (everything except 'type')
          const { type: _, ...data } = message
          const notificationData = Buffer.from(jsonStringify(data), 'utf-8')
          const lengthBuffer = Buffer.alloc(4)
          lengthBuffer.writeUInt32LE(notificationData.length, 0)
          const notificationMsg = Buffer.concat([
            lengthBuffer,
            notificationData,
          ])

          for (const [id, client] of this.mcpClients) {
            try {
              client.socket.write(notificationMsg)
            } catch (e) {
              log(`Failed to send notification to MCP client ${id}:`, e)
            }
          }
        }
        break
      }

      default:
        log(`Unknown message type: ${message.type}`)

        sendChromeMessage(
          jsonStringify({
            type: 'error',
            error: `Unknown message type: ${message.type}`,
          }),
        )
    }
  }
// 方法收尾：按消息类型完成路由。

// 处理一个新 MCP 客户端连接：注册入集合、通知 Chrome 已连接，并在 data/error/close 事件上做长度前缀拆包、转发工具请求、清理断开的客户端。
  private handleMcpClient(socket: Socket): void {
    const clientId = this.nextClientId++
    const client: McpClient = {
      id: clientId,
      socket,
      buffer: Buffer.alloc(0),
    }

    this.mcpClients.set(clientId, client)
    log(
      `MCP client ${clientId} connected. Total clients: ${this.mcpClients.size}`,
    )

    // Notify Chrome of connection
    sendChromeMessage(
      jsonStringify({
        type: 'mcp_connected',
      }),
    )

    socket.on('data', (data: Buffer) => {
      client.buffer = Buffer.concat([client.buffer, data])

      // Process complete messages
      while (client.buffer.length >= 4) {
        const length = client.buffer.readUInt32LE(0)

        if (length === 0 || length > MAX_MESSAGE_SIZE) {
          log(`Invalid message length from MCP client ${clientId}: ${length}`)
          socket.destroy()
          return
        }

        if (client.buffer.length < 4 + length) {
          break // Wait for more data
        }

        const messageBytes = client.buffer.slice(4, 4 + length)
        client.buffer = client.buffer.slice(4 + length)

        try {
          const request = jsonParse(
            messageBytes.toString('utf-8'),
          ) as ToolRequest
          log(
            `Forwarding tool request from MCP client ${clientId}: ${request.method}`,
          )

          // Forward to Chrome
          sendChromeMessage(
            jsonStringify({
              type: 'tool_request',
              method: request.method,
              params: request.params,
            }),
          )
        } catch (e) {
          log(`Failed to parse tool request from MCP client ${clientId}:`, e)
        }
      }
    })

    socket.on('error', err => {
      log(`MCP client ${clientId} error: ${err}`)
    })

    socket.on('close', () => {
      log(
        `MCP client ${clientId} disconnected. Remaining clients: ${this.mcpClients.size - 1}`,
      )
      this.mcpClients.delete(clientId)

      // Notify Chrome of disconnection
      sendChromeMessage(
        jsonStringify({
          type: 'mcp_disconnected',
        }),
      )
    })
  }
// 方法收尾：注册各类事件处理。
}

/**
 * Chrome message reader using async stdin. Synchronous reads can crash Bun, so we use
 * async reads with a buffer.
 */
// Chrome 消息读取器：用异步 stdin 读取（同步读会令 Bun 崩溃），带缓冲区与基于长度前缀的拆包。
class ChromeMessageReader {
  private buffer = Buffer.alloc(0)
  private pendingResolve: ((value: string | null) => void) | null = null
  private closed = false

  constructor() {
    process.stdin.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.tryProcessMessage()
    })

    process.stdin.on('end', () => {
      this.closed = true
      if (this.pendingResolve) {
        this.pendingResolve(null)
        this.pendingResolve = null
      }
    })

    process.stdin.on('error', () => {
      this.closed = true
      if (this.pendingResolve) {
        this.pendingResolve(null)
        this.pendingResolve = null
      }
    })
  }

  private tryProcessMessage(): void {
    if (!this.pendingResolve) {
      return
    }

    // Need at least 4 bytes for length prefix
    if (this.buffer.length < 4) {
      return
    }

    const length = this.buffer.readUInt32LE(0)

    if (length === 0 || length > MAX_MESSAGE_SIZE) {
      log(`Invalid message length: ${length}`)
      this.pendingResolve(null)
      this.pendingResolve = null
      return
    }

    // Check if we have the full message
    if (this.buffer.length < 4 + length) {
      return // Wait for more data
    }

    // Extract the message
    const messageBytes = this.buffer.subarray(4, 4 + length)
    this.buffer = this.buffer.subarray(4 + length)

    const message = messageBytes.toString('utf-8')
    this.pendingResolve(message)
    this.pendingResolve = null
  }

  async read(): Promise<string | null> {
    if (this.closed) {
      return null
    }

    // Check if we already have a complete message buffered
    if (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (
        length > 0 &&
        length <= MAX_MESSAGE_SIZE &&
        this.buffer.length >= 4 + length
      ) {
        const messageBytes = this.buffer.subarray(4, 4 + length)
        this.buffer = this.buffer.subarray(4 + length)
        return messageBytes.toString('utf-8')
      }
    }

    // Wait for more data
    return new Promise(resolve => {
      this.pendingResolve = resolve
      // In case data arrived between check and setting pendingResolve
      this.tryProcessMessage()
    })
  }
}
// 类收尾：提供 read 方法供主循环逐条读取。
