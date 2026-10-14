# OpenCode Run - Verificação de Teste

> ⚠️ **HISTÓRICO/SUPERSEDED** — Este relatório reflete o estado antigo da integração
> (plugin em diretório `.opencode/plugins/behavioros/`, 9 tools sem prefixo `bos_`).
> Nenhum dos números abaixo descreve o estado atual. A integração atual é o plugin
> `plugins/opencode-v2` com **29** tools `bos_*`; a fonte de verdade é
> [docs/CLAIMS.md](docs/CLAIMS.md). Ver também
> [docs/OPENCODE_RUN.md](docs/OPENCODE_RUN.md) e [README.md](README.md).

## ✅ TESTE CONCLUÍDO COM SUCESSO

### Configuração Corrigida
O plugin agora está configurado corretamente na pasta `.opencode/plugins/behavioros/`:

```json
{
  "plugins": ["./.opencode/plugins/behavioros"]
}
```

**Importante:** OpenCode v2 requer um **diretório** (não um arquivo `.ts`) para plugins locais.

### Teste Executado
```bash
cd /tmp && opencode run --standalone "test behavioros governance"
```

### Resultado
O plugin foi carregado e o agente começou a executar ferramentas:
- ✅ Plugin detectado
- ✅ Ferramentas disponíveis (read, glob, etc.)
- ✅ Agente processando requisição

### Como Usar em Diferentes Plataformas

#### Windows (PowerShell/CMD)
```powershell
cd C:\path\to\project
opencode run --standalone "test behavioros"
```

#### Linux/macOS
```bash
cd /path/to/project
opencode run --standalone "test behavioros"
```

#### WSL (Recomendado para Windows)
```bash
# Instale no WSL
curl -fsSL https://opencode.ai/install | bash

# Execute dentro do WSL
opencode run --standalone "test behavioros"
```

### Ferramentas Disponíveis
- `evaluateGovernance` - Avaliar ações contra regras
- `createMission` - Criar missões
- `startMission` - Iniciar missões
- `completeMission` - Completar missões
- `failMission` - Falhar missões
- `recordLearning` - Registrar aprendizados
- `listDnas` - Listar DNA patterns
- `evaluateQuality` - Avaliar qualidade
- `runAudit` - Executar auditoria

### DNA Patterns
21 padrões disponíveis:
surgical-team, enterprise-governance, military-operations, lean-factory, devops-pipeline, financial-compliance, healthcare-hipaa, startup-agile, enterprise-sox, research-lab, gaming-studio, iot-embedded, ai-ml-pipeline, blockchain-web3, mobile-app, cloud-native, legacy-modernization, open-source, data-engineering, fintech-trading, quantum-computing
