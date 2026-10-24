const fs = require('fs');
const path = require('path');

// Ensure Prisma query engine binaries are present in Vercel lambda search locations:
// 1. apps/web/.next/server
// 2. apps/web/packages/db/generated
// 3. apps/web/.next/standalone/apps/web/packages/db/generated
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'packages', 'db', 'generated');

if (!fs.existsSync(srcDir)) {
  console.log('[copy-prisma-engines] Source directory not found:', srcDir);
  process.exit(0);
}

const destinations = [
  path.join(rootDir, 'apps', 'web', '.next', 'server'),
  path.join(rootDir, 'apps', 'web', 'packages', 'db', 'generated'),
  path.join(rootDir, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'packages', 'db', 'generated'),
];

const files = fs.readdirSync(srcDir).filter((f) => f.includes('query_engine'));

destinations.forEach((dst) => {
  fs.mkdirSync(dst, { recursive: true });
  files.forEach((f) => {
    fs.copyFileSync(path.join(srcDir, f), path.join(dst, f));
    console.log(`[copy-prisma-engines] Copied ${f} -> ${dst}`);
  });
});
