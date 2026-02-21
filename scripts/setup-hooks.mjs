import { execSync } from 'node:child_process';

function run(command) {
  return execSync(command, {
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
}

try {
  const insideRepo = run('git rev-parse --is-inside-work-tree');
  if (insideRepo !== 'true') {
    process.exit(0);
  }

  const currentHooksPath = run('git config --get core.hooksPath || echo');
  if (currentHooksPath === '.githooks') {
    process.exit(0);
  }

  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
  console.log('Configured Git hooks path to .githooks');
} catch {
  // Keep install flow resilient in environments without git.
  process.exit(0);
}
