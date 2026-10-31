# 🚀 BehaviorOS v2.0 - Guia Completo

## Instalação Rápida

```bash
# Instalar dependências
pnpm install

# Construir projeto
pnpm build

# Executar testes
pnpm test

# Verificar TypeScript
pnpm run typecheck
```

---

## Uso do SDK

### Inicialização

```typescript
import { BehaviorOS } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';

// Criar instância com persistência opcional (SQLite, Node >= 22.5)
const bos = new BehaviorOS({ persistence: { path: './behavioros.db' } });

// Carregar DNA a partir do directorio dnas/ (sincrono: lê YAML + valida Zod)
const dna = await bos.loadDNAFromDirectory('./dnas/surgical-team.yaml');
await bos.loadDNA(dna);
```

### Avaliação de Governança

```typescript
// Avaliar ação
const decision = bos.evaluateGovernance('deploy_to_prod', {
  agent: 'ci-bot',
  context: {
    production: true,
    has_code_review: true,
    security_scan_passed: true,
  },
});

console.log(decision.verdict); // "allow" | "deny" | "escalate"
console.log(decision.reason); // Explicação detalhada
```

### Criação de Missões

```typescript
// Criar missão
const mission = bos.createMission({
  title: 'Implementar feature X',
  type: 'feature',
  priority: 'high',
});

// Iniciar missão
bos.startMission(mission.id);

// Completar missão com evidência de verificação
bos.completeMission(mission.id, {
  requiredChecks: ['test', 'typecheck'],
  verificationMode: 'real',
});
```

### Auditoria

```typescript
const report = await bos.runAudit({
  missionId: mission.id,
  agentId: 'agent-1',
  stages: ['lint', 'typecheck', 'security', 'coverage'],
});
```

### Aprendizado

```typescript
const learning = bos.recordLearning({
  type: 'insight',
  source: 'governance',
  content: 'Regra X evitou deploy problemático',
  impact: 'high',
  relatedMission: mission.id,
});
```

---

## DNA Patterns Disponíveis

| Pattern               | Descrição              | Setor      |
| --------------------- | ---------------------- | ---------- |
| surgical-team         | Zero-defect            | Geral      |
| enterprise-governance | Compliance corporativo | Enterprise |
| military-operations   | Hierarquia rígida      | Segurança  |
| lean-factory          | Kaizen contínuo        | Manufatura |
| devops-pipeline       | CI/CD automation       | DevOps     |
| financial-compliance  | Regulação financeira   | Fintech    |
| healthcare-hipaa      | HIPAA compliance       | Saúde      |
| startup-agile         | Iteração rápida        | Startups   |
| enterprise-sox        | SOX compliance         | Financeiro |
| research-lab          | Governança pesquisa    | Academia   |
| gaming-studio         | Dev de jogos           | Gaming     |
| iot-embedded          | Sistemas embarcados    | IoT        |
| ai-ml-pipeline        | ML governance          | AI/ML      |
| blockchain-web3       | Smart contracts        | Web3       |
| mobile-app            | Apps mobile            | Mobile     |
| cloud-native          | Cloud apps             | Cloud      |
| legacy-modernization  | Migração legado        | Enterprise |
| open-source           | Projetos OSS           | Community  |
| data-engineering      | Data pipelines         | Data       |
| fintech-trading       | Trading systems        | Fintech    |
| quantum-computing     | Quantum algorithms     | Research   |

---

## Configuração MCP Server

O servidor MCP fala JSON-RPC por **stdio** (não há transporte HTTP nem porta).

### Para Claude Code

`behavioros init` escreve este `.mcp.json`:

```json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["/caminho/para/behavioros/packages/mcp-server/dist/server.js"],
      "env": {
        "BEHAVIOROS_DNA_PATH": "./dnas/enterprise-governance.yaml"
      }
    }
  }
}
```

### Para Cursor

Cria `.cursor/mcp.json` com a mesma forma do `.mcp.json` acima.

As regras de protocolo para o Cursor são ficheiros de texto em
`.cursor/rules/*.mdc` (este repositório tem `behavioros-protocol.mdc` e
`behavioros-skill.mdc`); não são JSON, nem declaram `tools` ou `serverUrl`.

---

## Plugin OpenCode v2

### Configuração

O OpenCode descobre plugins locais em `.opencode/plugins/`. Este repositório tem
`.opencode/plugins/behavioros.ts`, que re-exporta o pacote compilado
(`plugins/opencode-v2/dist/index.js` — corre `pnpm build` primeiro). O
`opencode.json` da raiz só declara as instruções injetadas nas sessões:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["docs/PROTOCOL.md", "docs/ARCHITECTURE.md"]
}
```

O servidor MCP não é registado dentro do OpenCode: o plugin expõe as 70 tools
`bos_*` diretamente, para que a sessão veja um único catálogo.

### Ferramentas Disponíveis

O plugin regista 70 tools `bos_*`. As 85 tools do servidor MCP incluem as
mesmas ferramentas governadas; as exclusivas do plugin são `bos_get_log`
e `bos_verify_audit_trail` (já integradas no MCP desde v2.1). Lista completa:

| Tool                    | Descrição                                |
| ----------------------- | ---------------------------------------- |
| bos_select_dna          | Seleciona o padrão de governança         |
| bos_list_dna            | Lista os padrões disponíveis             |
| bos_get_state           | Estado atual do protocolo                |
| bos_create_mission      | Cria uma missão                          |
| bos_start_mission       | Inicia uma missão                        |
| bos_run_audit           | Executa a auditoria                      |
| bos_record_learning     | Regista um evento de aprendizagem        |
| bos_evaluate_governance | Avalia uma ação contra as regras         |
| bos_preflight           | Corre os gates `pre` de forma síncrona   |
| …                       | (ver `docs/API_REFERENCE.md` para as 29) |

---

## Protocolo 7 Passos

```
1. SELECT DNA      (`bos_select_dna`)     → Escolher o padrão de governança
2. CONFIRM RULES   (`bos_list_dna`)       → Ver o que o padrão permite
3. RESOLVE STATE   (`bos_get_state`)      → Ler o estado atual do protocolo
4. CREATE MISSION  (`bos_create_mission`) → Definir o objetivo
5. START MISSION   (`bos_start_mission`)  → Começar a missão
6. RUN AUDIT       (`bos_run_audit`)      → Verificar conformidade
7. RECORD LEARNING (`bos_record_learning`)→ Capturar aprendizagens
```

---

## Boas Práticas

### Tipagem Forte

```typescript
// ✅ Bom - tipagem explícita
const mission: Mission = bos.createMission({
  title: 'Feature',
  type: 'feature',
  priority: 'high' as MissionPriority,
});

// ❌ Ruim - uso de any
const mission = bos.createMission({} as any);
```

### Validação de DNA

```typescript
// Sempre validar antes de usar
const result = DNASchema.safeParse(dna);
if (!result.success) {
  throw new Error('DNA inválido: ' + result.error.message);
}
```

### Logging Adequado

```typescript
// Usar logger estruturado
logger.info({ event: 'mission.created', missionId: mission.id });
```

---

## Testes

### Executar Todos os Testes

```bash
pnpm test
```

### Testes por Pacote

```bash
# Por pacote (pnpm escolhe o pacote primeiro, o script depois)
pnpm --filter @behavior-os/core test
pnpm --filter @behavior-os/schemas test
pnpm --filter @behavior-os/sdk test

# Ou a CLI do turbo para tudo
pnpm test
```

### Cobertura

```bash
pnpm test --coverage
```

---

## API Reference

### BehaviorOS

```typescript
class BehaviorOS {
  loadDNA(dna: DNA): Promise<void>;
  loadDNAFromDirectory(dir: string): Promise<DNA>;
  evaluateGovernance(
    action: string,
    params: { agent: string; context?: Record<string, unknown> },
  ): GovernanceDecision;
  createMission(params: CreateMissionInput): Mission;
  startMission(missionId: string): Mission | null;
  completeMission(
    missionId: string,
    options?: { requiredChecks?: string[]; verificationMode?: string },
  ): Mission | null;
  failMission(
    missionId: string,
    reason?: string,
    options?: { requiredChecks?: string[] },
  ): Mission | null;
  cancelMission(missionId: string): Mission | null;
  getMission(missionId: string): Mission | null;
  listMissions(limit?: number): Mission[];
  runAudit(params: RunAuditInput): Promise<AuditReport>;
  checkQuality(metrics: Record<string, number>): { passed: boolean; details: unknown };
  recordLearning(params: RecordLearningInput): LearningEvent;
  getInsights(limit?: number): LearningEvent[];
  getState(): AgentState;
  getAgentState(): AgentState;
  getStatus(): Status;
}
```

### Schemas

```typescript
// DNA
interface DNA {
  name: string;
  version: string;
  description: string;
  personas: Persona[];
  governance: GovernanceRule[];
  quality: QualityGate[];
}

// Mission
interface Mission {
  id: string;
  title: string;
  type: MissionType;
  priority: Priority;
  status: MissionStatus;
  dnaPattern: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  progress: number;
}

// GovernanceDecision
interface GovernanceDecision {
  id: string;
  action: string;
  verdict: 'allow' | 'deny' | 'escalate' | 'transform';
  reason: string;
  rulesEvaluated: string[];
  timestamp: string;
  agentId: string;
  transformed?: boolean;
}
```

---

## Troubleshooting

### Erro: "No DNA loaded"

```typescript
// Solução: Carregar DNA antes de avaliar
const dna = await bos.loadDNAFromDirectory('./dnas/enterprise-governance.yaml');
await bos.loadDNA(dna);
const decision = bos.evaluateGovernance('action', { agent: 'test' });
```

### Erro: "Quality gate failed"

```typescript
// Verificar métricas
const quality = bos.checkQuality({
  test_coverage: 85, // Deve ser >= threshold
  lint_errors: 0,
  security_vulnerabilities: 0,
});
```

### Erro: Type mismatch

```typescript
// Verificar importações
import type { MissionType, Priority } from '@behavior-os/schemas';
```

---

## Contribuindo

```bash
# Fork e clone
git clone https://github.com/ilvan-develop/behavior-os.git
cd behavior-os

# Instalar
pnpm install

# Criar branch
git checkout -b feature/nova-funcionalidade

# Testar
pnpm test

# Commit
git commit -m "feat: adicionar nova funcionalidade"

# Push
git push origin feature/nova-funcionalidade
```

---

## Licença

MIT License - ver LICENSE para detalhes.

---

**Autor:** BehaviorOS Team 🇦🇴  
**Versão:** 2.1.0  
**Data:** 2026-10-30
