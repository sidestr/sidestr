#!/usr/bin/env node
// sidestr: a thin command over the library (issue #2). Every command is an existing wallet call plus
// formatting; no chain logic lives here. Read commands never need a key; spends print their plan and
// broadcast only with --yes. Plain text by default, --json for agents. Exit 0 ok, 1 error, 2 not enough funds.
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { openWallet, DEFAULTS } from '../index.mjs';

const HELP = `usage: sidestr <command> [args] [--chain ID | --mirror URL] [--key-file F] [--json]

  info                      the chain, its tip, and the mirror judged against the signer's announcement
  whoami                    this key's pubkey, address and did:nostr (needs a key)
  balance [addr]            spendable / immature sats of the key's address, or of addr
  coins [addr]              the unspent outputs behind that balance
  history [addr]            what the address received and spent, newest first
  tx <txid>                 the block a transaction was mined in, as far as the mirror knows
  send <to> <amount>        build and sign a spend; prints the plan; --yes broadcasts, --wait blocks until mined
  data <text>               a spend carrying text in an OP_RETURN (--hex: text is hex), change to self; --yes/--wait as send
  publish <hex>             broadcast a signed transaction over the relays
  faucet                    ask a faucet on the relays for coins to the key's address; --wait waits for them
  sign <hex32>              Schnorr-sign a 32-byte message (a txid, say) with the key; prints pub and sig

  key:    --key-file F, else $SIDESTR_KEY_FILE, else $SIDESTR_KEY (hex), else git config nostr.privkey (warned: plaintext)
  chain:  --chain ID (else $SIDESTR_CHAIN) finds the mirror from the announcement; --mirror URL (else $SIDESTR_MIRROR) pins one
  other:  --relays a,b  --fee N  --json  --no-cache (validate from genesis; the cache lives in ~/.cache/sidestr)`;

// --- arguments -------------------------------------------------------------------------------
const argv = process.argv.slice(2); const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const boolish = ['json', 'yes', 'wait', 'hex', 'no-cache', 'help'].includes(k); flags[k] = boolish ? true : argv[++i]; } else pos.push(a); }
const [cmd, ...args] = pos; const json = !!flags.json;
const out = (obj, text) => { if (json) console.log(JSON.stringify(obj, null, 2)); else console.log(typeof text === 'function' ? text() : text); };
const fail = (msg, code = 1) => { if (json) console.log(JSON.stringify({ error: msg })); else console.error(`error: ${msg}`); process.exit(code); };
if (!cmd || flags.help || cmd === 'help') { console.log(HELP); process.exit(0); }

// --- key (never on the command line) --------------------------------------------------------
function loadKey() {
  const file = flags['key-file'] ?? process.env.SIDESTR_KEY_FILE;
  let key = file ? readFileSync(file, 'utf8').trim() : process.env.SIDESTR_KEY?.trim();
  if (!key) { try { key = execFileSync('git', ['config', 'nostr.privkey'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (key && !json) console.error('note: key taken from git config nostr.privkey, which is plaintext in .git/config; a 0600 key file (--key-file) is safer'); } catch {} }
  if (!/^[0-9a-f]{64}$/i.test(key ?? '')) fail('no key: give --key-file F (32 bytes of hex), or set SIDESTR_KEY_FILE');
  return key.toLowerCase();
}

// --- the cache: one JSON file per chain, and the last good mirror ---------------------------
const cacheDir = `${homedir()}/.cache/sidestr`; const fileOf = (k) => `${cacheDir}/${k.replace(/[^a-z0-9._-]+/gi, '_')}.json`;
const store = flags['no-cache'] ? null : { get: (k) => existsSync(fileOf(k)) ? readFileSync(fileOf(k), 'utf8') : null, set: (k, v) => { mkdirSync(cacheDir, { recursive: true }); writeFileSync(fileOf(k), v); }, delete: (k) => { try { unlinkSync(fileOf(k)); } catch {} } };

// --- open ------------------------------------------------------------------------------------
const chain = flags.chain ?? process.env.SIDESTR_CHAIN; let mirror = flags.mirror ?? process.env.SIDESTR_MIRROR;
const relays = (flags.relays ?? process.env.SIDESTR_RELAYS ?? DEFAULTS.relays.join(',')).split(',').map((x) => x.trim()).filter(Boolean);
if (!chain && !mirror) fail('give --chain <id> or --mirror <url>');
const progress = json ? () => {} : (s) => process.stderr.write(`\r${s}…`.padEnd(60));
async function open() {
  const remembered = !mirror && chain && store ? store.get(`sidestr:mirror:${chain}`) : null; // the last good mirror skips the relay lookup
  let w;
  try { w = await openWallet({ mirror: mirror ?? remembered ?? undefined, chain, relays, store: store ?? undefined, onProgress: progress }); }
  catch (e) { if (!remembered) throw e; store.delete(`sidestr:mirror:${chain}`); w = await openWallet({ chain, relays, store: store ?? undefined, onProgress: progress }); }
  if (!json) process.stderr.write('\r'.padEnd(60) + '\r');
  if (chain && store) store.set(`sidestr:mirror:${chain}`, w.mirror);
  return w;
}
const sats = (n) => Number(n).toLocaleString('en-US');
const scriptOf = (w, addr) => addr ? w.resolveTo(addr).script : w.identity(loadKey()).script;
const opReturn = (bytes) => { if (bytes.length > 80) throw new Error('at most 80 bytes of data'); const len = bytes.length.toString(16).padStart(2, '0'); return '6a' + (bytes.length <= 75 ? len : '4c' + len) + Buffer.from(bytes).toString('hex'); };
async function waitMined(w, txid, seconds = 180) { for (let i = 0; i < seconds / 5; i++) { const m = await w.mined(txid); if (m) return m; await new Promise((r) => setTimeout(r, 5000)); } return null; }

async function spend(w, built, key) {
  if (!w.verify(built, key)) fail('the signatures do not verify');
  const plan = { txid: built.txid, inputs: built.inputs.map((c) => ({ outpoint: c.outpoint, value: c.value })), outputs: built.tx.outputs.map((o) => ({ value: o.value, script: o.scriptPubKey })), amount: built.amount, fee: built.fee, vsize: built.vsize, change: built.change, note: built.note, hex: built.hex, broadcast: false };
  if (!flags.yes) { out(plan, () => `plan (not sent; add --yes)\n  txid    ${plan.txid}\n  inputs  ${plan.inputs.map((i) => `${i.outpoint} ${sats(i.value)}`).join(', ')}\n  outputs ${plan.outputs.map((o) => `${sats(o.value)} → ${w.ex.address(o.script)}`).join(', ')}\n  fee     ${sats(plan.fee)} sats (${plan.vsize} vB)${plan.note ? `\n  note    ${plan.note}` : ''}\n  hex     ${plan.hex}`); return; }
  const r = await w.publish(built.hex, relays); if (!r.accepted) fail(`no relay accepted the transaction: ${JSON.stringify(r.results)}`);
  plan.broadcast = true; plan.event = r.event; plan.relays = r.results;
  if (flags.wait) { const m = await waitMined(w, built.txid); if (!m) fail(`published (event ${r.event}) but not mined within 3 minutes`); plan.mined = m; }
  out(plan, () => `sent ${plan.txid}${plan.mined ? ` — mined in block ${plan.mined.height}` : ` — published (event ${plan.event}), not yet mined`}`);
}

try {
  const w = await open(); const tip = w.tip;
  switch (cmd) {
    case 'info': { const v = await w.judgeMirror().catch((e) => ({ ok: null, note: e.message })); out({ chain: w.chain.id, name: w.chain.name, parent: w.chain.parent, prefix: w.hrp, height: tip.height, hash: tip.hash, time: tip.time, mirror: w.mirror, fromCache: w.fromCache, rules: w.chain.rules ?? [], mirrorVerdict: v }, () => `${w.chain.id} (${w.chain.name}) beside ${w.chain.parent}\n  height   ${tip.height} ${tip.hash}\n  mirror   ${w.mirror} — ${v.ok === true ? 'matches the signer\'s announcement' : v.ok === false ? 'DISAGREES with the announcement' : 'not judged'}: ${v.note}\n  checked  ${w.fromCache === null ? 'every block, from genesis' : `from the cached state at ${w.fromCache}`}${w.chain.rules?.length ? `\n  rules    ${w.chain.rules.join(', ')}` : ''}`); break; }
    case 'whoami': { const me = w.identity(loadKey()); out({ pubkey: me.pub, address: me.address, script: me.script, did: `did:nostr:${me.pub}` }, () => `${me.address}\n  pubkey ${me.pub}\n  did    did:nostr:${me.pub}`); break; }
    case 'balance': { const s = scriptOf(w, args[0]); const b = w.balance(s); out({ address: w.ex.address(s), ...b, height: tip.height }, () => `${sats(b.spendable)} sats spendable${b.immature ? `, ${sats(b.immature)} immature` : ''} at ${w.ex.address(s)} (height ${tip.height})`); break; }
    case 'coins': { const s = scriptOf(w, args[0]); const cs = w.coins(s); out({ address: w.ex.address(s), coins: cs }, () => cs.length ? cs.map((c) => `${c.outpoint}  ${sats(c.value).padStart(14)} sats  block ${c.height}${c.coinbase ? c.mature ? '  (claim, mature)' : `  (claim, matures at ${c.maturesAt})` : ''}`).join('\n') : 'no coins'); break; }
    case 'history': { const s = scriptOf(w, args[0]); const h = w.history(s); out({ address: w.ex.address(s), history: h }, () => h.length ? h.map((x) => `${x.dir === 'in' ? '+' : '-'}${sats(x.value).padStart(14)}  block ${x.height}  ${x.txid}`).join('\n') : 'nothing yet'); break; }
    case 'tx': { if (!/^[0-9a-f]{64}$/i.test(args[0] ?? '')) fail('give a txid'); const m = await w.mined(args[0].toLowerCase()); out({ txid: args[0], mined: m }, () => m ? `mined in block ${m.height}` : 'not mined, as far as the mirror knows'); if (!m) process.exitCode = 1; break; }
    case 'send': { if (!args[0] || !args[1]) fail('send <to> <amount>'); const key = loadKey(); let b; try { b = w.build({ key, to: args[0], amount: Number(args[1]), fee: flags.fee ?? null }); } catch (e) { fail(e.message, /not enough/.test(e.message) ? 2 : 1); } await spend(w, b, key); break; }
    case 'data': { if (args[0] == null) fail('data <text> [--hex]'); const key = loadKey(); const bytes = flags.hex ? Buffer.from(args[0], 'hex') : Buffer.from(args[0], 'utf8'); let b; try { b = w.build({ key, to: null, amount: 0, fee: flags.fee ?? null, carrier: { script: opReturn(bytes), note: `${bytes.length} bytes in an OP_RETURN` } }); } catch (e) { fail(e.message, /not enough/.test(e.message) ? 2 : 1); } await spend(w, b, key); break; }
    case 'publish': { if (!/^[0-9a-f]+$/i.test(args[0] ?? '')) fail('publish <hex>'); let txid; try { txid = w.ex.k.codec.txid(w.ex.k.codec.decode('Transaction', args[0].toLowerCase())); } catch (e) { fail(`not a transaction: ${e.message}`); } const r = await w.publish(args[0].toLowerCase(), relays); if (!r.accepted) fail(`no relay accepted it: ${JSON.stringify(r.results)}`); out({ txid, event: r.event, relays: r.results }, () => `published ${txid} (event ${r.event})`); break; }
    case 'sign': { if (!/^[0-9a-f]{64}$/i.test(args[0] ?? '')) fail('sign <32 bytes of hex>'); const key = loadKey(); const me = w.identity(key); const sig = w.ex.hash.bytesToHex(w.signer.schnorrSign(w.ex.hash.hexToBytes(args[0].toLowerCase()), key)); out({ message: args[0].toLowerCase(), pub: me.pub, sig }, () => `pub ${me.pub}\nsig ${sig}`); break; }
    case 'faucet': { const me = w.identity(loadKey()); const before = w.balance(me.script).total; const r = await w.requestFaucet(me.address, relays); if (!r.accepted) fail(`no relay accepted the request: ${JSON.stringify(r.results)}`);
      const res = { address: me.address, event: r.event, relays: r.results }; if (flags.wait) { let got = null; for (let i = 0; i < 24 && !got; i++) { await new Promise((x) => setTimeout(x, 5000)); await w.refresh(); const now = w.balance(me.script).total; if (now > before) got = now - before; } if (!got) fail('asked, but no coins arrived within 2 minutes (no faucet listening, or this address was paid in the last 24 h)'); res.received = got; }
      out(res, () => res.received ? `received ${sats(res.received)} sats at ${me.address}` : `asked (event ${r.event}); coins arrive in a few seconds if a faucet is listening`); break; }
    default: fail(`unknown command "${cmd}"\n${HELP}`);
  }
  process.exit(process.exitCode ?? 0);
} catch (e) { fail(e.message); }
