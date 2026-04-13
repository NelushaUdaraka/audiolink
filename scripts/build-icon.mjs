import { readFileSync, writeFileSync } from 'fs';
import png2icons from 'png2icons';

const input = readFileSync('build/icon.png');

// BILINEAR interpolation, 0 = all standard sizes, usePNG=false (BMP format for NSIS compatibility)
const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, false, true);

if (!ico) {
  console.error('✗ Failed to generate icon.ico');
  process.exit(1);
}

writeFileSync('build/icon.ico', ico);
console.log('✓ build/icon.ico generated (BMP format, NSIS compatible)');
