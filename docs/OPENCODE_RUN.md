# OpenCode Run - Instruções de Uso

## Status
✅ Plugin instalado e detectado
⚠️ `opencode run` requer PowerShell/CMD nativo (não funciona via Git Bash)

## Como usar

### Opção 1: PowerShell (Recomendado)
```powershell
cd C:\www\behavior-os
opencode run --standalone "test behavioros governance"
```

### Opção 2: CMD
```cmd
cd C:\www\behavior-os
opencode run --standalone "test behavioros governance"
```

### Opção 3: Git Bash (com workaround)
```bash
# Abrir PowerShell temporariamente
powershell.exe -Command "cd 'C:\www\behavior-os'; opencode run --standalone 'test behavioros'"
```

## Plugin Detectado
```
$ opencode plugin list
ID           VERSION  SOURCE
behavior-os  local    C:\www\behavior-os\.opencode\plugins\behavioros.ts
```

> O loader em `.opencode/plugins/behavioros.ts` aponta para o build do
> `plugins/opencode-v2` (`dist/index.js`) — auto-discovery nativo do OpenCode v2.
> O MCP server **não** é registado no `opencode.json` (`.mcp.json` é ignorado pelo v2);
> mantém-se como pacote standalone para clientes MCP externos.

## Ferramentas Disponíveis (12 × `bos_*`)
- `bos_evaluate_governance` - Avaliar ações contra regras de governança
- `bos_create_mission` - Criar novas missões
- `bos_start_mission` - Iniciar missão
- `bos_list_missions` - Listar missões (com filtros)
- `bos_check_quality` - Verificar gates de qualidade
- `bos_get_insights` - Obter insights do learning engine
- `bos_get_state` - Estado atual do protocolo
- `bos_get_status` - Status atual do Behavior-OS
- `bos_list_dna` - Listar padrões DNA disponíveis
- `bos_record_learning` - Registrar aprendizados
- `bos_run_audit` - Executar auditoria
- `bos_select_dna` - Selecionar padrão DNA

> **Nota**: usa `opencode run --agent <agent>` para a sessão carregar o plugin.
> Sem `--agent`, a sessão corre sem agente e as tools `bos_*` podem não aparecer.
> O `currentStep` do protocolo avança automaticamente (monotónico, de 1 a 7):
> selecionar DNA → listar DNA → resolver estado → criar/iniciar missão → auditoria →
> aprendizagem. O hook de contexto mostra sempre o próximo passo.

## DNA Patterns Disponíveis
21 padrões carregados dinamicamente:
surgical-team, enterprise-governance, military-operations, lean-factory, devops-pipeline, financial-compliance, healthcare-hipaa, startup-agile, enterprise-sox, research-lab, gaming-studio, iot-embedded, ai-ml-pipeline, blockchain-web3, mobile-app, cloud-native, legacy-modernization, open-source, data-engineering, fintech-trading, quantum-computing
