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
behavior-os  local    C:\www\behavior-os\.opencode\plugins\behavioros\index.ts
```

## Ferramentas Disponíveis
- `evaluateGovernance` - Avaliar ações contra regras de governança
- `createMission` - Criar novas missões
- `startMission` - Iniciar missão
- `completeMission` - Completar missão
- `failMission` - Falhar missão com motivo
- `recordLearning` - Registrar aprendizados
- `listDnas` - Listar padrões DNA disponíveis
- `evaluateQuality` - Avaliar métricas de qualidade
- `runAudit` - Executar auditoria

## DNA Patterns Disponíveis
21 padrões carregados dinamicamente:
surgical-team, enterprise-governance, military-operations, lean-factory, devops-pipeline, financial-compliance, healthcare-hipaa, startup-agile, enterprise-sox, research-lab, gaming-studio, iot-embedded, ai-ml-pipeline, blockchain-web3, mobile-app, cloud-native, legacy-modernization, open-source, data-engineering, fintech-trading, quantum-computing
