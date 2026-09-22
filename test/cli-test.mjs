// The sidestr command against a live mirror (default: the local melchain producer). Read commands, error
// paths and a dry-run spend; nothing is broadcast. A throwaway key file is made under the scratch dir.
//   node test/cli-test.mjs [mirror]
import { spawnSync } from 'node:child_process'; import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { randomBytes } from 'node:crypto';
const mirror = process.argv[2] ?? 'http://127.0.0.1:3451'; const dir = mkdtempSync(`${tmpdir()}/sidestr-cli-`); const keyFile = `${dir}/key`; writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
let ok = 0, bad = 0; const t = (name, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? ok++ : bad++; };
const run = (...a) => { const r = spawnSync(process.execPath, ['bin/sidestr.mjs', ...a, '--mirror', mirror], { encoding: 'utf8', env: { ...process.env, HOME: dir } }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const J = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const info = J(run('info', '--json')); t('info: chain, tip, mirror verdict as JSON', !!info && /^sidestr:/.test(info.chain) && info.height > 0 && 'mirrorVerdict' in info && info.fromCache === null);
const info2 = J(run('info', '--json')); t('a second run resumes from the cache in $HOME/.cache/sidestr', info2?.fromCache === info.height);
t('info as text names the chain and the height', new RegExp(`${info.chain}.*\\n\\s+height\\s+${info.height}`).test(run('info').out));
const me = J(run('whoami', '--json', '--key-file', keyFile)); t('whoami: pubkey, address with the chain prefix, did:nostr', !!me && /^[0-9a-f]{64}$/.test(me.pubkey) && me.address.startsWith(`${info.prefix}1p`) && me.did === `did:nostr:${me.pubkey}`);
t('whoami without a key fails with exit 1 and a hint', (() => { const r = run('whoami'); return r.code === 1 && /--key-file/.test(r.err); })());
const bal = J(run('balance', '--json', '--key-file', keyFile)); t('balance of a fresh key is 0', bal?.spendable === 0 && bal?.total === 0 && bal.address === me.address);
t('balance of a given address needs no key', J(run('balance', me.address, '--json'))?.total === 0);
t('coins and history of a fresh key are empty', J(run('coins', '--json', '--key-file', keyFile))?.coins.length === 0 && J(run('history', '--json', '--key-file', keyFile))?.history.length === 0);
const spend = run('send', me.address, '1000', '--key-file', keyFile); t('a spend from an empty key exits 2 (not enough funds)', spend.code === 2 && /not enough/.test(spend.err));
t('data from an empty key exits 2 too', run('data', 'hello', '--key-file', keyFile).code === 2);
t('tx of an unknown txid exits 1', run('tx', 'ab'.repeat(32)).code === 1);
t('publish of non-transaction hex exits 1 without broadcasting', (() => { const r = run('publish', 'deadbeef'); return r.code === 1 && /not a transaction/.test(r.err); })());
t('an unknown command exits 1 and prints usage', (() => { const r = run('nope'); return r.code === 1 && /usage: sidestr/.test(r.err); })());
t('--help exits 0', spawnSync(process.execPath, ['bin/sidestr.mjs', '--help'], { encoding: 'utf8' }).status === 0);
console.log(`${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
