import { exec } from 'node:child_process';
import dns from 'node:dns/promises';

export function getMacAddress(ip: string): Promise<string | null> {
  if (ip === '127.0.0.1' || ip === 'localhost') return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    exec(`arp -a ${ip}`, (err, stdout) => {
      clearTimeout(timer);
      if (err || !stdout) return resolve(null);
      // Windows uses hyphens (aa-bb-cc), Linux/Mac use colons (aa:bb:cc)
      const m = stdout.match(
        /([0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2}[:-][0-9a-f]{2})/i
      );
      if (!m) return resolve(null);
      resolve(m[1].toUpperCase().replace(/-/g, ':'));
    });
  });
}

export async function getDeviceName(ip: string): Promise<string | null> {
  if (ip === '127.0.0.1') return 'localhost';
  try {
    const hosts = await Promise.race<string[]>([
      dns.reverse(ip),
      new Promise<string[]>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), 1500)
      ),
    ]);
    // Strip FQDN to just the short hostname
    return hosts[0]?.split('.')[0] ?? null;
  } catch {
    return null;
  }
}
