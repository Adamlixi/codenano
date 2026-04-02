/**
 * Query Tracking Usage Examples
 *
 * 演示如何使用 Query Tracking 功能
 */

import { createAgent, defineTool } from 'codenano'
import { z } from 'zod'

// ============================================================================
// 示例 1: 基础使用 - 监听 query_start 事件
// ============================================================================

async function example1_basicUsage() {
  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are a helpful assistant.',
  })

  console.log('=== Example 1: Basic Usage ===')

  for await (const event of agent.stream('Say hello')) {
    if (event.type === 'query_start') {
      console.log('Query started:')
      console.log('  Chain ID:', event.queryTracking.chainId)
      console.log('  Depth:', event.queryTracking.depth)
    }

    if (event.type === 'result') {
      console.log('Query completed:')
      console.log('  Chain ID:', event.result.queryTracking.chainId)
      console.log('  Depth:', event.result.queryTracking.depth)
    }
  }
}

// ============================================================================
// 示例 2: 从 Result 获取 queryTracking
// ============================================================================

async function example2_fromResult() {
  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })

  console.log('\n=== Example 2: From Result ===')

  const result = await agent.ask('What is 2+2?')

  console.log('Result:', result.text)
  console.log('Query Tracking:', result.queryTracking)
  // { chainId: '...', depth: 0 }
}

// ============================================================================
// 示例 3: Session 中的 queryTracking
// ============================================================================

async function example3_session() {
  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })

  const session = agent.session()

  console.log('\n=== Example 3: Session ===')

  // 第一轮
  const result1 = await session.send('My name is Alice')
  console.log('Turn 1:')
  console.log('  Chain ID:', result1.queryTracking.chainId)
  console.log('  Depth:', result1.queryTracking.depth) // 0

  // 第二轮 - 继承 chainId，depth + 1
  const result2 = await session.send('What is my name?')
  console.log('Turn 2:')
  console.log('  Chain ID:', result2.queryTracking.chainId) // 相同
  console.log('  Depth:', result2.queryTracking.depth) // 1

  // 验证 chainId 相同
  console.log('Same chain?', result1.queryTracking.chainId === result2.queryTracking.chainId)
}

// ============================================================================
// 示例 4: 与日志系统集成
// ============================================================================

async function example4_withLogging() {
  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })

  console.log('\n=== Example 4: With Logging ===')

  // 简单的日志函数
  function log(level: string, message: string, tracking: any) {
    const timestamp = new Date().toISOString()
    console.log(`[${timestamp}] [${level}] [${tracking.chainId.slice(0, 8)}:${tracking.depth}] ${message}`)
  }

  for await (const event of agent.stream('Calculate 10 + 20')) {
    if (event.type === 'query_start') {
      log('INFO', 'Query started', event.queryTracking)
    }

    if (event.type === 'text') {
      log('DEBUG', `Text: ${event.text.slice(0, 50)}...`, { chainId: 'current', depth: 0 })
    }

    if (event.type === 'result') {
      log('INFO', `Query completed in ${event.result.durationMs}ms`, event.result.queryTracking)
    }
  }
}

// ============================================================================
// 示例 5: 工具调用追踪
// ============================================================================

async function example5_toolTracking() {
  const calculatorTool = defineTool({
    name: 'Calculator',
    description: 'Perform calculations',
    input: z.object({
      expression: z.string(),
    }),
    execute: async ({ expression }) => {
      return `Result: ${eval(expression)}`
    },
  })

  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
    tools: [calculatorTool],
    systemPrompt: 'Use Calculator tool for math.',
  })

  console.log('\n=== Example 5: Tool Tracking ===')

  let currentTracking: any = null

  for await (const event of agent.stream('What is 15 * 23?')) {
    if (event.type === 'query_start') {
      currentTracking = event.queryTracking
      console.log(`[${currentTracking.chainId.slice(0, 8)}:${currentTracking.depth}] Query started`)
    }

    if (event.type === 'tool_use') {
      console.log(`[${currentTracking.chainId.slice(0, 8)}:${currentTracking.depth}] Tool: ${event.toolName}`)
    }

    if (event.type === 'tool_result') {
      console.log(`[${currentTracking.chainId.slice(0, 8)}:${currentTracking.depth}] Tool result: ${event.output}`)
    }
  }
}

// ============================================================================
// 示例 6: 多个 Agent 实例
// ============================================================================

async function example6_multipleAgents() {
  console.log('\n=== Example 6: Multiple Agents ===')

  const agent1 = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })

  const agent2 = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })

  const result1 = await agent1.ask('Hello')
  const result2 = await agent2.ask('Hello')

  console.log('Agent 1 Chain ID:', result1.queryTracking.chainId)
  console.log('Agent 2 Chain ID:', result2.queryTracking.chainId)
  console.log('Different chains?', result1.queryTracking.chainId !== result2.queryTracking.chainId)
}

// ============================================================================
// 示例 7: 错误追踪
// ============================================================================

async function example7_errorTracking() {
  const agent = createAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  })

  console.log('\n=== Example 7: Error Tracking ===')

  let tracking: any = null

  try {
    for await (const event of agent.stream('Test query')) {
      if (event.type === 'query_start') {
        tracking = event.queryTracking
      }

      if (event.type === 'error') {
        console.error(`[${tracking.chainId}:${tracking.depth}] Error:`, event.error.message)
      }
    }
  } catch (error) {
    if (tracking) {
      console.error(`[${tracking.chainId}:${tracking.depth}] Exception:`, error)
    }
  }
}

// ============================================================================
// 运行所有示例
// ============================================================================

async function runAllExamples() {
  await example1_basicUsage()
  await example2_fromResult()
  await example3_session()
  await example4_withLogging()
  await example5_toolTracking()
  await example6_multipleAgents()
  await example7_errorTracking()
}

// 取消注释以运行
// runAllExamples().catch(console.error)

export {
  example1_basicUsage,
  example2_fromResult,
  example3_session,
  example4_withLogging,
  example5_toolTracking,
  example6_multipleAgents,
  example7_errorTracking,
}
