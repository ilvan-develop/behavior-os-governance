/**
 * Wrapper para executar opencode run com o caminho correto do Windows
 * Resolve o problema de MSYS path translation no Windows
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const projectDir = 'C:/www/behavior-os';
const absoluteDir = resolve(projectDir);

console.log(`📁 Working directory: ${absoluteDir}`);
console.log('🧪 Running opencode run...\n');

const child = spawn(
  'cmd.exe',
  [
    '/c',
    '"C:\\Users\\waldi\\AppData\\Roaming\\npm\\opencode.cmd"',
    'run',
    '--standalone',
    '--format',
    'json',
    'test behavioros governance plugin',
  ],
  {
    cwd: absoluteDir,
    stdio: ['inherit', 'inherit', 'inherit'],
  },
);

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('❌ Failed to start opencode:', err.message);
  process.exit(1);
});
