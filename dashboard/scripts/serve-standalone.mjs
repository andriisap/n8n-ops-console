// Runs the standalone production build the way the Docker image does: the server bundle
// plus the static files copied next to it (output: 'standalone' leaves them out).
import { cpSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

if (!existsSync('.next/standalone/server.js')) {
  console.error('No production build: run `npm run build` first.');
  process.exit(1);
}
cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
if (existsSync('public')) cpSync('public', '.next/standalone/public', { recursive: true });

const server = spawn(process.execPath, ['server.js'], { cwd: '.next/standalone', stdio: 'inherit', env: process.env });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
