

# codenano

[![npm version](https://img.shields.io/npm/v/codenano.svg)](https://www.npmjs.com/package/codenano)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-374%20passing-brightgreen.svg)](https://github.com/Adamlixi/codenano)

**El SDK ligero para agentes de programación con IA, inspirado en la arquitectura de agentes de producción.**

Construido con patrones probados en escenarios reales de sistemas de programación con IA en producción. ~8.000 líneas de código enfocado, cero bloat (exceso). Código abierto, totalmente personalizable, listo para producción.

> 💡 **Patrones de Calidad de Producción** — Arquitectura de bucle de agentes inspirada en asistentes de programación con IA del mundo real, ahora disponible como un SDK independiente.

## ¿Por qué codenano?

### 🚀 **Ligero y Enfocado**
- **~8.000 líneas** de código puro y enfocado
- Cero bloat, cero sobrecarga
- **Motor de agentes de calidad de producción**

### ⚡ **Crea Agentes de Programación con IA Rápido**
```bash
npm install codenano
```
Construye tu propio agente de programación con IA en 60 segundos. Sin IDE requerido. Sin restricciones.

### 🎯 **Arquitectura Probada en Producción**
Patrones de agentes de calidad de producción. Validado a gran escala, optimizado para desarrolladores.

---

## Inicio Rápido

**Pon tu primer agente en marcha en 3 líneas:**

```typescript
import { createAgent, coreTools } from 'codenano'

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: coreTools(),  // Read, Edit, Write, Glob, Grep, Bash
})

const result = await agent.ask('Read package.json and summarize it')
console.log(result.text)
```

**Eso es todo.** Sin configuración compleja. Sin inferno de ajustes. Solo productividad pura.

### ¿Streaming? Integrado.

```typescript
for await (const event of agent.stream('What files are here?')) {
  if (event.type === 'text') process.stdout.write(event.text)
}
```

### ¿Conversaciones multinivel? Fácil.

```typescript
const session = agent.session()
await session.send('Read main.ts')
await session.send('Now explain what it does')
```

### ¿Persistencia de sesiones? Integrada.

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: coreTools(),
  persistence: { enabled: true },  // saves to ~/.agent-core/sessions/
})

const session = agent.session()
console.log(session.id)  // save this UUID
await session.send('Analyze the codebase')

// Later — resume from where you left off
const resumed = agent.session(session.id)
await resumed.send('What did we find?')
```

### ¿Memoria entre sesiones? Automática.

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  memory: {
    autoLoad: true,           // inject saved memories into system prompt
    extractStrategy: 'auto',  // extract memories after every turn
  },
})

// The agent learns from conversations and remembers across sessions:
// - User preferences and role
// - Feedback on approach (what to avoid/repeat)
// - Project context and decisions
// - Pointers to external systems
```

Las memorias se almacenan como archivos markdown con frontmatter, indexados por `MEMORY.md`. Usa la API independiente para acceso directo:

```typescript
import { saveMemory, scanMemories, loadMemoryIndex } from 'codenano'

saveMemory({
  name: 'user_role',
  description: 'User is a backend engineer',
  type: 'user',
  content: 'Expert in Go and Python, new to React',
}, '/path/to/memory')

const memories = scanMemories('/path/to/memory')
```

### Rutas de almacenamiento

Tanto la memoria como la persistencia de sesiones tienen valores predeterminados sensatos y admiten rutas personalizadas. Los directorios se crean automáticamente si no existen.

| Característica | Ruta Predeterminada | Configuración Personalizada |
|----------------|---------------------|-----------------------------|
| **Memoria** | `~/.agent-core/memory/<cwd-hash>/` | `memory.memoryDir` |
| **Sesión** | `~/.agent-core/sessions/` | `persistence.storageDir` |

```typescript
// Use defaults — zero config
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  memory: { autoLoad: true, extractStrategy: 'auto' },
  persistence: { enabled: true },
})

// Or specify custom paths
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  memory: { memoryDir: './my-project/memory', autoLoad: true },
  persistence: { enabled: true, storageDir: './my-project/sessions' },
})
```

### ¿Seguimiento de costos? Automático.

Cada `Result` incluye `costUSD`: costo estimado de la API basado en el precio del modelo.

```typescript
const result = await agent.ask('Explain this code')
console.log(`Cost: $${result.costUSD.toFixed(4)}`)  // e.g. $0.0047
```

Usa la API independiente para la gestión de presupuesto:

```typescript
import { CostTracker, calculateCostUSD } from 'codenano'

const tracker = new CostTracker()
tracker.add('claude-sonnet-4-6', result.usage)
console.log(`Total: $${tracker.summary.totalUSD.toFixed(4)}`)
```

### ¿Integración con Git? Integrada.

Detección automática del estado del repositorio git para inyección en el prompt del sistema:

```typescript
import { getGitState, buildGitPromptSection } from 'codenano'

const state = getGitState()
// { isGit: true, branch: 'main', commitHash: 'abc123...', isClean: false, ... }

const section = buildGitPromptSection(state)
// "- Is a git repository: true\n- Current branch: main\n..."
```

### ¿Ganchos de ciclo de vida? 8 disponibles.

Observa y controla el comportamiento del agente en cada punto del ciclo de vida:

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: coreTools(),

  onTurnStart: ({ turnNumber }) => console.log(`Turn ${turnNumber}`),

  // Block dangerous tools
  onPreToolUse: ({ toolName, toolInput }) => {
    if (toolName === 'Bash' && toolInput.command?.includes('rm -rf'))
      return { block: 'Destructive commands blocked' }
  },

  onPostToolUse: ({ toolName, output }) => console.log(`${toolName}: ${output.slice(0, 50)}`),
  onCompact: ({ messagesBefore, messagesAfter }) => console.log(`Compacted: ${messagesBefore} → ${messagesAfter}`),
  onError: ({ error }) => console.error(error.message),
  onMaxTurns: () => console.warn('Max turns reached'),
})
```

Todos los ganchos son de mejor esfuerzo; los errores en los ganchos nunca detienen el agente.

### ¿Creación de subagentes? Una sola función.

```typescript
import { createAgent, createAgentTool, coreTools } from 'codenano'

const config = { model: 'claude-sonnet-4-6', tools: coreTools() }
const agentTool = createAgentTool(config)

const agent = createAgent({
  ...config,
  tools: [...coreTools(), agentTool],  // model can now spawn sub-agents
})
```

### ¿Análisis de contexto? Listo.

Analiza el contexto de la conversación para identificar oportunidades de compresión:

```typescript
import { analyzeContext, classifyTool } from 'codenano'

const analysis = analyzeContext(session.history)
// { toolCalls: 5, duplicateFileReads: { '/a.ts': 3 }, collapsibleResults: 4, ... }

classifyTool('Grep')   // 'search'
classifyTool('Bash')   // 'execute'
```

### ¿Habilidades (Skills)? Carga desde disco.

Las habilidades son archivos Markdown con frontmatter YAML:

```typescript
import { loadSkills, createSkillTool, createAgent } from 'codenano'

// Load skills from .claude/skills/ directories
const skills = loadSkills()

// Create a functional SkillTool
const skillTool = createSkillTool(skills)

const agent = createAgent({
  model: 'claude-sonnet-4-6',
  tools: [skillTool],  // model can invoke skills via the Skill tool
})
```

Formato del archivo de habilidad (`.claude/skills/my-skill/SKILL.md`):
```markdown
---
name: review-pr
description: Review a pull request
arguments: [pr_number]
context: inline
---
Review PR #$pr_number. Focus on bugs and security.
```

### ¿Protocolo MCP? Compatible.

Conéctate a cualquier servidor MCP y usa sus herramientas:

```typescript
import { createAgent, connectMCPServers } from 'codenano'

const { tools, connections } = await connectMCPServers([
  { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
])

const agent = createAgent({ model: 'claude-sonnet-4-6', tools })
const result = await agent.ask('List open issues')

// Cleanup
await disconnectAll(connections)
```

### Herramientas Personalizadas

```typescript
import { defineTool } from 'codenano'
import { z } from 'zod'

const readFile = defineTool({
  name: 'ReadFile',
  description: 'Read a file from disk',
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

## codenano vs Otros Frameworks

**Ligero, de calidad de producción, inspirado en patrones probados en escenarios reales.**

| Característica | codenano | Vercel AI SDK | LangChain |
|----------------|----------|---------------|-----------|
| **Filosofía** | Inspirado en sistemas de programación con IA de producción | SDK de IA de propósito general | Framework general de agentes |
| **Líneas de Código** | ~8.000 (enfocado) | ~15.000+ | 100.000+ |
| **Qué Incluye** | Motor de agente + 17 herramientas | Multi-modelo + streaming | Todo y más |
| **Tiempo de Configuración** | < 1 minuto | < 1 minuto | 10+ minutos |
| **Caso de Uso** | Construir agentes de programación | Construir cualquier app de IA | Construir flujos de trabajo complejos |
| **Endurecimiento para Producción** | ✅ Completo (compresión, recuperación, presupuesto) | ⚠️ Básico | ⚠️ Básico |
| **Ejecución de Herramientas con Streaming** | ✅ Sí | ❌ No | ❌ No |
| **Código Abierto** | ✅ Licencia MIT | ✅ Apache 2.0 | ✅ Licencia MIT |

**¿Cuándo usar codenano?**
- Construyendo herramientas o agentes de programación con IA
- Necesitas fiabilidad de calidad de producción (auto-compresión, recuperación de 413, presupuesto de herramientas)
- Quieres una arquitectura ligera y enfocada
- Prefieres patrones probados en producción sobre características experimentales

---

## Lo que Obtienes

### 🛠️ **17 Herramientas Integradas**
Listas para usar, configuración cero:
- **Operaciones de Archivo:** Read, Edit, Write
- **Búsqueda de Código:** Glob (coincidencia de patrones), Grep (búsqueda con expresiones regulares)
- **Ejecución:** Comandos Bash
- **Avanzadas:** Búsqueda web, obtención web, notebooks, LSP y más

### 🎨 **Tres Conjuntos Predefinidos de Herramientas**
```typescript
coreTools()      // Essential 6 tools
extendedTools()  // Core + 5 more
allTools()       // All 17 tools
```

### 🔧 **Características de Producción**
- ✅ Auto-compresión (maneja el desbordamiento de contexto)
- ✅ Reintento y reserva (llamadas a API resilientes)
- ✅ Presupuesto de tokens (control de costos)
- ✅ Sistema de permisos (seguridad)
- ✅ Sistema de ganchos (eventos del ciclo de vida)
- ✅ Soporte para streaming (salida en tiempo real)
- ✅ Sistema de memoria (persistencia entre sesiones)
- ✅ Seguimiento de consultas (depuración/analítica)
- ✅ Persistencia de sesión (guardar/reanudar basado en JSONL)
- ✅ Ganchos extendidos (8 ganchos del ciclo de vida: onTurnStart, onPreToolUse, onPostToolUse, onCompact, onError, etc.)

---

## Estructura del Sistema

**Arquitectura limpia y modular:**

```
codenano/
  src/
    agent.ts           # Core agent loop
    session.ts         # Multi-turn conversations
    session-storage.ts # Session persistence (JSONL)
    hooks.ts           # Lifecycle hook helpers
    cost-tracker.ts    # Token-based cost tracking
    git.ts             # Git state detection
    context-analysis.ts # Tool classification & context analysis
    tools/             # 17 built-in tools + createAgentTool
    prompt/            # System prompt builder
    memory/            # Persistent memory system
    provider.ts        # Anthropic SDK + Bedrock
    compact.ts         # Auto-compact logic
  tests/               # 374 tests
  examples/            # Ready-to-run demos
  docs/                # Comprehensive guides
```

**374 pruebas. 100% listo para producción.**

---

## Documentación

| Documento | Lo que Aprenderás |
|-----------|-------------------|
| [Arquitectura](docs/architecture.md) | Bucle del agente, modos de interacción, eventos de streaming |
| [Herramientas](docs/tools.md) | Herramientas integradas, personalizadas, permisos |
| [Configuración](docs/configuration.md) | Referencia completa de configuración, soporte para CLAUDE.md |
| [Fiabilidad](docs/reliability.md) | Auto-compresión, reintento, reserva, presupuesto |
| [Sistema de Prompts](docs/prompt-system.md) | Arquitectura del prompt del sistema |
| [Análisis de Brechas](docs/gap-analysis.md) | Comparación SDK vs Claude Code |

---

## Pruebas

```bash
# Unit tests (374 tests)
npm test

# With coverage
npx vitest run --coverage

# Integration tests (requires API key)
ANTHROPIC_API_KEY=sk-xxx npm run test:integration
```

---

## Hoja de Ruta

**Implementado:**
- [x] Sistema de memoria (persistencia entre sesiones)
- [x] Herramientas de gestión de tareas
- [x] Seguimiento de consultas (depuración/analítica)
- [x] Ganchos de parada (callbacks del ciclo de vida)
- [x] Presupuesto de resultados de herramientas
- [x] Persistencia de sesiones (guardar/reanudar basado en JSONL)
- [x] Ganchos extendidos (8 ganchos del ciclo de vida)
- [x] Seguimiento de costos (estimación en USD basada en tokens)
- [x] Integración con Git (detección de estado, inyección en prompt)
- [x] Creación de subagentes (createAgentTool)
- [x] Compresión de contexto (clasificación de herramientas, análisis de contexto)
- [x] Soporte para protocolo MCP (transportes stdio/SSE/HTTP)

**¡Hoja de ruta completa!**

---

## ¿Por Qué Elegir codenano?

### Para Startups
**Lanza tu producto de programación con IA más rápido.** Deja de luchar con frameworks inflados. Llega al mercado en días, no en meses.

### Para Empresas
**Listo para producción desde el día uno.** Arquitectura probada en combate, pruebas exhaustivas, control total sobre tu stack.

### Para Desarrolladores
**Realmente agradable de usar.** APIs limpias, excelente documentación, cero magia. Construye lo que quieras, como quieras.

---

## Licencia

Licencia MIT.

---

## Comienza Ahora

```bash
npm install codenano
```

**¿Preguntas?** Consulta la [documentación](docs/) o abre un issue.

**¿Listo para construir?** Consulta [examples/](examples/) para inspiración.
