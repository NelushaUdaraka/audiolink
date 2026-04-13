/**
 * Runs electron-builder with automatic retry.
 * Windows Defender sometimes locks freshly-written executables for a
 * few seconds, causing "UNKNOWN: unknown error, open AudioLink.exe".
 * Retrying after a short pause is enough to get past it.
 */
import { execSync } from 'child_process';

const args = process.argv.slice(2).join(' ');
const cmd = `electron-builder build --win ${args}`;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4000;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    console.log(`\n  • build attempt ${attempt}/${MAX_RETRIES}`);
    execSync(cmd, { stdio: 'inherit' });
    process.exit(0);
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.log(`\n  ⚠ Build failed — retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    } else {
      process.exit(err.status ?? 1);
    }
  }
}
