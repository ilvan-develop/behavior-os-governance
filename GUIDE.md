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
import { BehaviorOS } from "@behavior-os/core";
import { loadDNA, evaluateGovernance } from "@behavior-os/sdk";

// Criar instância
const bos = new BehaviorOS();

// Carregar DNA
const surgicalDNA = await loadDNA("./dnas/surgical-team.yaml");
await bos.loadDNA(surgicalDNA);
```

### Avaliação de Governança

```typescript
// Avaliar ação
const decision = bos.evaluateGovernance("deploy_to_prod", {
  agent: "ci-bot",
  context: {
    production: true,
    has_code_review: true,
    security_scan_passed: true,
  },
});

console.log(decision.verdict); // "allow" | "deny" | "escalate"
console.log(decision.reason);  // Explicação detalhada
```

### Criação de Missões

```typescript
// Criar missão
const mission = bos.createMission({
  title: "Implementar feature X",
  type: "feature",
  priority: "high",
});

// Iniciar missão
bos.startMission(mission.id);

// Completar missão
bos.completeMission(mission.id);
```

### Auditoria

```typescript
const report = bos.runAudit({
  missionId: mission.id,
  agentId: "agent-1",
  stages: ["lint", "typecheck", "security", "coverage"],
});
```

### Aprendizado

```typescript
const learning = bos.recordLearning({
  type: "insight",
  source: "governance",
  content: "Regra X evitou deploy problemático",
  impact: "high",
  relatedMission: mission.id,
});
```

---

## DNA Patterns Disponíveis

| Pattern | Descrição | Setor |
|---------|-----------|-------|
| surgical-team | Zero-defect | Geral |
| enterprise-governance | Compliance corporativo | Enterprise |
| military-operations | Hierarquia rígida | Segurança |
| lean-factory | Kaizen contínuo | Manufatura |
| devops-pipeline | CI/CD automation | DevOps |
| financial-compliance | Regulação financeira | Fintech |
| healthcare-hipaa | HIPAA compliance | Saúde |
| startup-agile | Iteração rápida | Startups |
| enterprise-sox | SOX compliance | Financeiro |
| research-lab | Governança pesquisa | Academia |
| gaming-studio | Dev de jogos | Gaming |
| iot-embedded | Sistemas embarcados | IoT |
| ai-ml-pipeline | ML governance | AI/ML |
| blockchain-web3 | Smart contracts | Web3 |
| mobile-app | Apps mobile | Mobile |
| cloud-native | Cloud apps | Cloud |
| legacy-modernization | Migração legado | Enterprise |
| open-source | Projetos OSS | Community |
| data-engineering | Data pipelines | Data |
| fintech-trading | Trading systems | Fintech |
| quantum-computing | Quantum algorithms | Research |

---

## Configuração MCP Server

### Para Claude

```json
// .mcp.json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "/c/www/behavior-os"
    }
  }
}
```

### Para Cursor

```json
// .cursor/rules/behavioros-skill.mdc
{
  "serverUrl": "http://localhost:3001",
  "tools": ["bos_evaluate_governance", "bos_select_dna", ...]
}
```

---

## Plugin OpenCode v2

### Configuração

```json
// opencode.json
{
  "plugins": [
    {
      "package": "./plugins/opencode-v2/dist/index.js",
      "options": { "enabled": true }
    }
  ]
}
```

### Ferramentas Disponíveis

| Tool | Descrição |
|------|-----------|
| bos_evaluate_governance | Avalia governança |
| bos_select_dna | Seleciona DNA |
| bos_list_dna | Lista DNAs |
| bos_create_mission | Cria missões |
| bos_run_audit | Executa auditoria |
| bos_record_learning | Registra aprendizado |
| bos_get_status | Status do sistema |
| bos_get_state | Estado completo |

---

## Protocolo 7 Passos

```
1. SELECT DNA     → Escolher padrão governança
2. DISPLAY BLOCK  → Mostrar DNA selecionado  
3. RESOLVE TRUTH  → Analisar contexto real
4. CREATE MISSION → Definir objetivo claro
5. DELEGATE       → Atribuir execução
6. RUN AUDIT      → Verificar conformidade
7. RECORD LEARNING → Capturar insights
```

---

## Boas Práticas

### Tipagem Forte

```typescript
// ✅ Bom - tipagem explícita
const mission: Mission = bos.createMission({
  title: "Feature",
  type: "feature",
  priority: "high" as MissionPriority,
});

// ❌ Ruim - uso de any
const mission = bos.createMission({} as any);
```

### Validação de DNA

```typescript
// Sempre validar antes de usar
const result = DNASchema.safeParse(dna);
if (!result.success) {
  throw new Error("DNA inválido: " + result.error.message);
}
```

### Logging Adequado

```typescript
// Usar logger estruturado
logger.info({ event: "mission.created", missionId: mission.id });
```

---

## Testes

### Executar Todos os Testes

```bash
pnpm test
```

### Testes por Pacote

```bash
pnpm test --filter @behavior-os/core
pnpm test --filter @behavior-os/schemas
pnpm test --filter @behavior-os/sdk
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
  loadDNA(dna: DNA): Promise<void>
  evaluateGovernance(action: string, params: { agent: string; context?: Record<string, unknown> }): GovernanceDecision
  createMission(params: CreateMissionInput): Mission
  startMission(missionId: string): Mission | null
  completeMission(missionId: string): Mission | null
  failMission(missionId: string, reason?: string): Mission | null
  getMission(missionId: string): Mission | null
  listMissions(): Mission[]
  runAudit(params: RunAuditInput): AuditReport
  evaluateQuality(metrics: Record<string, number> | null): QualityResult
  recordLearning(params: RecordLearningInput): LearningEvent
  getInsights(limit: number): LearningEvent[]
  getState(): AgentState
  getAgentState(): AgentMetrics
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
  verdict: "allow" | "deny" | "escalate" | "transform";
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
await bos.loadDNA(dna);
const decision = bos.evaluateGovernance("action", { agent: "test" });
```

### Erro: "Quality gate failed"

```typescript
// Verificar métricas
const quality = bos.evaluateQuality({
  test_coverage: 85,  // Deve ser >= threshold
  lint_errors: 0,
  security_vulnerabilities: 0,
});
```

### Erro: Type mismatch

```typescript
// Verificar importações
import type { MissionType, Priority } from "@behavior-os/schemas";
```

---

## Contribuindo

```bash
# Fork e clone
git clone https://github.com/ilvan-develop/behavioros.git
cd behavioros

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
**Versão:** 2.0.0  
**Data:** 2026-10-10
