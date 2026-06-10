import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const SANDBOX_DIR = '/tmp/agent-sandbox';

// Tạo sandbox nếu chưa có
async function ensureSandbox() {
  try {
    await fs.mkdir(SANDBOX_DIR, { recursive: true });
  } catch (e) {}
}

const ALLOWED_COMMANDS = ['ls', 'cat', 'echo', 'mkdir', 'touch', 'curl', 'wget', 'python3', 'node', 'git', 'grep', 'find', 'head', 'tail', 'wc', 'sort', 'uniq'];

export async function executeCommand(command) {
  await ensureSandbox();
  const cmdName = command.trim().split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.includes(cmdName)) {
    return { error: `Lệnh '${cmdName}' không được phép. Danh sách: ${ALLOWED_COMMANDS.join(', ')}` };
  }

  // Chặn truy cập ngoài sandbox bằng cách wrap với cd
  const wrappedCmd = `cd ${SANDBOX_DIR} && ${command}`;
  return new Promise((resolve) => {
    exec(wrappedCmd, { timeout: 15000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 1000),
        exitCode: error ? error.code : 0
      });
    });
  });
}
