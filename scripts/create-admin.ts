import { closeIdentityPool, ensureAdminUser } from '@ff/identity';
import { closeNanoBrainPool, ensureDefaultPrivateSource } from '@ff/nano-brain';

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export async function ensureDefaultAdmin(input: { username?: string; password?: string } = {}) {
  const username = input.username ?? getArg('username') ?? process.env.ADMIN_USERNAME;
  const password = input.password ?? getArg('password') ?? process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required, or pass --username=... --password=...');
  }

  try {
    const user = await ensureAdminUser({ username, password });
    await ensureDefaultPrivateSource({ userId: user.id, username: user.username });
    console.log(`ensured admin: ${user.username} (${user.id})`);
    return user;
  } finally {
    await closeIdentityPool();
    await closeNanoBrainPool();
  }
}

if (import.meta.main) {
  ensureDefaultAdmin().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
