// sidestr in Node: the wallet library with the engine, the sidestr overlay and the explorer taken
// from this package's installed dependencies instead of a CDN. Everything the library validates
// it validates here; a mirror is read over HTTP, relays over WebSocket, nothing else is trusted.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const dir = (spec) => dirname(fileURLToPath(import.meta.resolve(spec)));
export const paths = {
  cdn: dir('@bitcoin-desktop/schema/package.json'),
  lib: `${dir('@sidestr/spec/package.json')}/siding/lib`,
  explorer: `${dir('@sidestr/explorer/package.json')}/explorer.mjs`,
};
const wallet = await import('@sidestr/wallet');
export const { Wallet, DEFAULTS } = wallet;
const loadJson = async (u) => /^https?:/.test(u) ? (await fetch(u)).json() : JSON.parse(readFileSync(u, 'utf8'));
// openWallet({ chain | mirror, relays?, onProgress? }) — the same call as in a page, resolved locally
export function openWallet(opts = {}) { return wallet.openWallet({ cdn: paths.cdn, lib: paths.lib, explorer: paths.explorer, loadJson, ...opts }); }
export default openWallet;
