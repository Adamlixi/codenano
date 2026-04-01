# codenano

**从 Claude Code 提取的轻量级 AI 编码代理 SDK。**

通过逆向工程 Claude Code 的生产架构构建。保留所有能力，去除冗余。开源、完全可定制、生产就绪。

> 💡 **基于 Claude Code** — 与驱动 Anthropic 官方编码助手的战斗测试引擎相同，现在作为独立 SDK 提供。

[English](README.md) | 简体中文

## 为什么选择 codenano？

### 🚀 **Claude Code 的核心，轻 97%**
- **5,500 行**纯粹、专注的代码
- Claude Code：150,000+ 行（IDE 集成、UI 等）
- **相同的代理引擎，零开销**

### ⚡ **Claude Code 能做的，你也能做**
```bash
npm install codenano
```
60 秒内构建你自己的 Claude Code。无需 IDE。无限制。

### 🎯 **经过实战检验的架构**
从 Claude Code 的生产引擎中提取。大规模验证，为开发者优化。

---

## 快速开始

**3 行代码运行你的第一个代理：**

```typescript
import { createAgent, coreTools } from 'codenano'

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: coreTools(),  // Read, Edit, Write, Glob, Grep, Bash
})

const result = await agent.ask('读取 package.json 并总结它')
console.log(result.text)
```

**就是这样。**无需复杂设置。无需配置地狱。只有纯粹的生产力。

### 流式输出？内置。

```typescript
for await (const event of agent.stream('这里有什么文件？')) {
  if (event.type === 'text') process.stdout.write(event.text)
}
```

### 多轮对话？简单。

```typescript
const session = agent.session()
await session.send('读取 main.ts')
await session.send('现在解释它做什么')
```

### 自定义工具

```typescript
import { defineTool } from 'codenano'
import { z } from 'zod'

const readFile = defineTool({
  name: 'ReadFile',
  description: '从磁盘读取文件',
  input: z.object({ path: z.string() }),
  execute: async ({ path }) => fs.readFileSync(path, 'utf-8'),
  isReadOnly: true,
})

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: [readFile],
})
```

---

## codenano vs Claude Code

**相同的引擎。不同的理念。**

| 特性 | codenano | Claude Code |
|------|----------|-------------|
| **基于** | Claude Code 核心 | Anthropic 官方产品 |
| **代码行数** | 5,500（仅核心） | 150,000+（完整应用） |
| **包含内容** | 代理引擎 | 引擎 + IDE + UI |
| **设置时间** | < 1 分钟 | 安装 IDE 扩展 |
| **用例** | 构建自定义代理 | 在 IDE 中直接使用 |
| **可定制性** | ✅ 完全开放 | ⚠️ 闭源 |
| **独立运行** | ✅ 是 | ❌ 需要 IDE |
| **生产就绪** | ✅ 是 | ✅ 是 |
| **开源** | ✅ MIT 许可 | ❌ 专有 |

**这样理解：**
- **Claude Code** = 完整汽车（引擎 + 车身 + 内饰）
- **codenano** = 只有引擎（自己造车）

**何时使用 codenano：**
- 构建自定义 AI 编码工具
- 将代理集成到你的产品中
- 需要完全控制行为
- 想要理解它如何工作

**何时使用 Claude Code：**
- 只想用 AI 辅助编码
- 更喜欢 Anthropic 官方支持
- 满意 IDE 集成

---

## 工作原理

**codenano 提取了 Claude Code 的代理循环：**

```
1. 用户发送消息
2. 代理使用工具调用 Claude API
3. Claude 决定：响应或使用工具
4. 如果使用工具 → 执行 → 发送结果
5. 重复直到完成
```

**我们从 Claude Code 提取了什么：**
- ✅ 代理循环逻辑
- ✅ 工具执行系统
- ✅ 流式支持
- ✅ 多轮会话
- ✅ 自动压缩（上下文管理）
- ✅ 权限系统
- ✅ 重试和回退

**我们排除了什么：**
- ❌ IDE 集成
- ❌ UI 组件
- ❌ 文件监视器
- ❌ Git UI
- ❌ 桌面应用外壳

**结果：**纯粹的代理引擎，可嵌入任何地方。

---

## 你能得到什么

### 🛠️ **17 个内置工具**
开箱即用，零配置：
- **文件操作：** Read、Edit、Write
- **代码搜索：** Glob（模式匹配）、Grep（正则搜索）
- **执行：** Bash 命令
- **高级：** Web 搜索、Web 获取、笔记本、LSP 等

### 🎨 **三种工具预设**
```typescript
coreTools()      // 基础 6 个工具
extendedTools()  // 核心 + 5 个
allTools()       // 全部 17 个工具
```

### 🔧 **生产特性**
- ✅ 自动压缩（处理上下文溢出）
- ✅ 重试和回退（弹性 API 调用）
- ✅ Token 预算（成本控制）
- ✅ 权限系统（安全）
- ✅ 钩子系统（生命周期事件）
- ✅ 流式支持（实时输出）

---

## 系统结构

**清晰、模块化的架构：**

```
codenano/
  src/
    agent.ts           # 核心代理循环
    session.ts         # 多轮对话
    tools/             # 17 个内置工具
    prompt/            # 系统提示构建器
    provider.ts        # Anthropic SDK + Bedrock
    compact.ts         # 自动压缩逻辑
  tests/               # 191 个测试
  examples/            # 可运行示例
  docs/                # 完整文档
```

**191 个测试。100% 生产就绪。**

---

## 文档

| 文档 | 你将学到 |
|------|----------|
| [架构](docs/architecture.md) | 代理循环、交互模式、流事件 |
| [工具](docs/tools.md) | 内置工具、自定义工具、权限 |
| [配置](docs/configuration.md) | 完整配置参考、CLAUDE.md 支持 |
| [可靠性](docs/reliability.md) | 自动压缩、重试、回退、预算 |
| [提示系统](docs/prompt-system.md) | 系统提示架构 |
| [差异分析](docs/gap-analysis.md) | SDK vs Claude Code 对比 |

---

## 测试

```bash
# 单元测试（191 个测试）
npm test

# 带覆盖率
npx vitest run --coverage

# 集成测试（需要 API 密钥）
ANTHROPIC_API_KEY=sk-xxx npm run test:integration
```

---

## 路线图

**即将推出：**
- [ ] 钩子系统（16 种事件类型）
- [ ] 子代理生成
- [ ] 内存系统（跨会话持久化）
- [ ] MCP 协议支持
- [ ] 会话持久化
- [ ] Git 集成
- [ ] 成本跟踪

---

## 为什么选择 codenano？

### 对于初创公司
**更快交付你的 AI 编码产品。**停止与臃肿框架搏斗。几天而非几个月上市。

### 对于企业
**从第一天起就生产就绪。**经过实战检验的架构、全面测试、完全控制你的技术栈。

### 对于开发者
**真正好用。**清晰的 API、优秀的文档、零魔法。按你想要的方式构建。

---

## 许可证

从 Claude Code 提取，用于教育和开发目的。

---

## 立即开始

```bash
npm install codenano
```

**有问题？**查看[文档](docs/)或提交 issue。

**准备构建？**查看[示例](examples/)获取灵感。
