// The package resolves everything locally and opens a live chain by id: node test/package-test.mjs
import { openWallet, paths } from '../index.mjs';
import { existsSync } from 'node:fs';
let ok = 0, bad = 0; const t = (n, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}`); c ? ok++ : bad++; };
t('the engine, the sidestr lib and the explorer resolve inside node_modules', existsSync(`${paths.cdn}/codec/kernel.js`) && existsSync(`${paths.lib}/relay.mjs`) && existsSync(paths.explorer));
const w = await openWallet({ chain: process.env.SIDESTR_CHAIN ?? 'sidestr:txbt4-siding' });
t(`opened ${w.chain.id} by id from the relays and validated it to block ${w.tip.height}`, w.tip.height > 0);
const key = w.newKey(); const id = w.identity(key); t('a fresh key has an address on this chain', id.address.startsWith(w.chain.addressPrefix + '1'));
t('a spend from an empty key is refused before anything is signed', (() => { try { w.build({ key, to: id.address, amount: 1000 }); return false; } catch (e) { return /not enough/.test(e.message); } })());
console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
