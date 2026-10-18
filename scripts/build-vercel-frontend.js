const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const configuredApiBase = process.env.LABCORE_API_BASE;

if (!configuredApiBase) {
  throw new Error('Set LABCORE_API_BASE to the HTTPS backend URL ending in /api.');
}

let apiBase;
try {
  const parsed = new URL(configuredApiBase);
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !pathname.endsWith('/api')) {
    throw new Error('Expected an HTTPS URL ending in /api with no credentials, query, or fragment.');
  }
  apiBase = parsed.origin + pathname;
} catch (error) {
  throw new Error(`Invalid LABCORE_API_BASE: ${error.message}`);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.html')) {
    fs.copyFileSync(path.join(root, entry.name), path.join(output, entry.name));
  }
}

fs.cpSync(path.join(root, 'shared'), path.join(output, 'shared'), { recursive: true });

const apiAdapter = path.join(output, 'shared', 'labcore-api.js');
const adapterSource = fs.readFileSync(apiAdapter, 'utf8');
const defaultBase = "window.LABCORE_API_BASE = window.LABCORE_API_BASE || window.__LABCORE_API_BASE__ || window.location.origin + '/api';";
if (!adapterSource.includes(defaultBase)) {
  throw new Error('Could not find the expected API base initialization in shared/labcore-api.js.');
}
fs.writeFileSync(
  apiAdapter,
  adapterSource.replace(defaultBase, `window.LABCORE_API_BASE = ${JSON.stringify(apiBase)};`),
  'utf8'
);

console.log(`Built frontend in ${path.relative(root, output)} for ${apiBase}`);
