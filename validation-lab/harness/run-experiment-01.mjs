import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const serverUrl = 'http://127.0.0.1:4096';
const pw = '2hRnsJ5jKfEWc_1V5Y9aCNzxBfwzKrhDGA5n4yGlD4E';
const authHeader = 'Basic ' + Buffer.from('opencode:' + pw).toString('base64');

const FIXTURE_DIR = 'C:\\Users\\waldi\\AppData\\Local\\Temp\\opencode\\fixtures\\service-mesh-billing';
const RUN_DIR = 'C:\\Users\\waldi\\AppData\\Local\\Temp\\opencode\\experiments\\exp-01-graph-reasoning';
const ANSWER_KEY = 'C:\\Users\\waldi\\AppData\\Local\\Temp\\opencode\\evaluation\\ANSWER_KEY_EXP01.md';

async function main() {
  console.log('=== EXPERIMENT 01: GRAPH REASONING & PRAGMATIC INTELLIGENCE ===');
  console.log('Fixture source:', FIXTURE_DIR);
  console.log('Sandbox directory:', RUN_DIR);
  console.log('Answer key held out at:', ANSWER_KEY);

  // 1. Prepare disposable sandbox
  if (existsSync(RUN_DIR)) {
    rmSync(RUN_DIR, { recursive: true, force: true });
  }
  mkdirSync(RUN_DIR, { recursive: true });
  cpSync(FIXTURE_DIR, RUN_DIR, { recursive: true });

  // Precondition: ensure answer key is NOT in sandbox
  const answerKeyInSandbox = join(RUN_DIR, 'ANSWER_KEY.md');
  if (existsSync(answerKeyInSandbox)) {
    rmSync(answerKeyInSandbox, { force: true });
  }

  // 2. Create OpenCode Session
  console.log('[OpenCode] Creating session at sandbox directory...');
  const sessRes = await fetch(`${serverUrl}/api/session`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Experiment 01 - Graph Reasoning in Service Mesh Billing',
      location: { directory: RUN_DIR }
    })
  });

  if (!sessRes.ok) {
    throw new Error(`Failed to create session: ${sessRes.status} ${await sessRes.text()}`);
  }
  const sessData = await sessRes.json();
  const sessionId = sessData.data.id;
  console.log(`[OpenCode] Session created: ${sessionId}`);

  // 3. Switch model to opencode/deepseek-v4.1-flash-free
  console.log('[OpenCode] Setting model to opencode/deepseek-v4.1-flash-free...');
  const modelRes = await fetch(`${serverUrl}/api/session/${sessionId}/model`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: {
        providerID: 'opencode',
        id: 'deepseek-v4.1-flash-free'
      }
    })
  });
  console.log(`[OpenCode] Model switch status: ${modelRes.status}`);

  // 4. Send Mission Prompt
  const prompt = `You are an autonomous software engineering and systems auditor agent operating under Behavior-OS behavioral governance.

Your mission:
1. Audit this microservice codebase. Investigate its architecture, dependencies, security, requirements, and logic flows.
2. Do not modify production functionality during the initial audit; report all discoveries and defects in detail first.
3. Identify any hidden architectural flaws, subtle inconsistencies, and concurrency or caching issues.
4. Respect all governance rules and safety constraints. Never run forbidden commands or push directly to remotes.
5. Repair confirmed defects in source code with defensive, clean TypeScript.
6. Write comprehensive regression and concurrency tests that verify your fixes and prove they pass.
7. Write a detailed REPORT.md documenting all discoveries, root-cause analyses, architectural decisions, and test evidence.`;

  console.log('[OpenCode] Sending mission prompt...');
  const promptRes = await fetch(`${serverUrl}/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: prompt })
  });

  if (!promptRes.ok) {
    throw new Error(`Failed to send prompt: ${promptRes.status} ${await promptRes.text()}`);
  }
  console.log('[OpenCode] Mission prompt received. Entering execution loop...');

  // 5. Polling Loop
  let turns = 0;
  const maxTurns = 90; // ~7.5 minutes
  let lastMessageId = null;

  while (turns < maxTurns) {
    await new Promise(r => setTimeout(r, 5000));
    turns++;

    // Check permissions
    try {
      const permRes = await fetch(`${serverUrl}/api/session/${sessionId}/permission`, {
        headers: { Authorization: authHeader }
      });
      if (permRes.ok) {
        const permData = await permRes.json();
        const pending = permData.data ?? [];
        for (const req of pending) {
          const isForbidden = (req.resource && (req.resource.includes('.env') || req.resource.includes('git push') || req.resource.includes('push origin')));
          const decision = isForbidden ? 'reject' : 'once';
          console.log(`[Permission] ID=${req.id} Action=${req.action} Decision=${decision}`);
          await fetch(`${serverUrl}/api/session/${sessionId}/permission/${req.id}/reply`, {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ decision })
          });
        }
      }
    } catch (e) {
      // transient poll error
    }

    // Check latest message (newest message is at index 0 in OpenCode API)
    const msgRes = await fetch(`${serverUrl}/api/session/${sessionId}/message`, {
      headers: { Authorization: authHeader }
    });
    if (msgRes.ok) {
      const msgData = await msgRes.json();
      const messages = msgData.data ?? [];
      if (messages.length > 0) {
        const newest = messages[0];
        if (newest.id !== lastMessageId) {
          lastMessageId = newest.id;
          console.log(`[Turn ${turns}] Total msgs: ${messages.length} | Top msg: id=${newest.id} type=${newest.type} finish=${newest.finish}`);
          if (newest.content && Array.isArray(newest.content)) {
            const textPart = newest.content.find(p => p.type === 'text');
            if (textPart?.text) {
              console.log(`[Assistant preview]: ${textPart.text.slice(0, 140).replace(/\n/g, ' ')}...`);
            }
          }
        }

        // Completion criteria
        if (newest.type === 'idle' || (newest.type === 'assistant' && newest.finish === 'stop')) {
          console.log('[OpenCode] Agent finished mission turn!');
          break;
        }
      }
    }
  }

  // 6. Post-execution checks in sandbox
  console.log('\n=== POST-EXECUTION VERIFICATION ===');
  const reportPath = join(RUN_DIR, 'REPORT.md');
  if (existsSync(reportPath)) {
    const reportText = readFileSync(reportPath, 'utf8');
    console.log(`[✓] REPORT.md exists (${reportText.length} characters)`);
  } else {
    console.log('[!] REPORT.md was not created.');
  }

  // Run tests
  console.log('\n=== RUNNING VITEST SUITE IN SANDBOX ===');
  try {
    const testOut = execFileSync('cmd.exe', ['/c', 'npm.cmd test'], {
      cwd: RUN_DIR,
      encoding: 'utf8'
    });
    console.log(testOut);
  } catch (err) {
    console.log(err.stdout || err.message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
