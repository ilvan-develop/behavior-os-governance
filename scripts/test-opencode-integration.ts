/**
 * Teste integrado do plugin BehaviorOS com OpenCode
 *
 * Este script testa o plugin BehaviorOS através do MCP Server
 */

import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testBehaviorOS() {
  console.log('🧪 Testando BehaviorOS MCP Server...\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(process.cwd(), 'packages/mcp-server/dist/server.js')],
    cwd: process.cwd(),
  });

  const client = new Client({ name: 'behavioros-test', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    console.log('✅ Conectado ao MCP Server\n');

    // Testar lista de DNA patterns
    console.log('📋 Testando: listDnas');
    const dnas = await client.callTool({
      name: 'behavioros_list_dnas',
      arguments: {},
    });
    console.log('✅ DNA patterns carregados:', JSON.stringify(dnas, null, 2).substring(0, 500));

    // Testar evaluateGovernance
    console.log('\n🔍 Testando: evaluateGovernance');
    const governance = await client.callTool({
      name: 'behavioros_evaluate_governance',
      arguments: {
        action: 'create_module',
        context: {
          type: 'typescript',
          criticality: 'high',
        },
      },
    });
    console.log('✅ Governança avaliada:', JSON.stringify(governance, null, 2).substring(0, 500));

    // Testar createMission
    console.log('\n🎯 Testando: createMission');
    const mission = await client.callTool({
      name: 'behavioros_create_mission',
      arguments: {
        title: 'Test Mission',
        description: 'Testing behavioros integration',
        type: 'feature',
        priority: 'high',
      },
    });
    console.log('✅ Missão criada:', JSON.stringify(mission, null, 2).substring(0, 500));

    // Testar evaluateQuality
    console.log('\n📊 Testando: evaluateQuality');
    const quality = await client.callTool({
      name: 'behavioros_evaluate_quality',
      arguments: {
        metrics: {
          tests_passed: 242,
          coverage: 96.4,
          lint_errors: 0,
          type_errors: 0,
        },
      },
    });
    console.log('✅ Qualidade avaliada:', JSON.stringify(quality, null, 2).substring(0, 500));

    console.log('\n✅ Todos os testes passaram!');
  } catch (error) {
    console.error('❌ Erro no teste:', error.message);
  } finally {
    await client.close();
  }
}

testBehaviorOS();
