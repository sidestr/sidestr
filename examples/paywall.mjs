#!/usr/bin/env node
// A paywall that trusts nothing but the chain: it validates tally itself, watches its own address, and opens
// one route to whoever paid it 0.01 SHELL and can sign the payment's txid with the key that paid.
// Ephemeral by design: no dependency beyond this package, no state beyond the chain, a key file it makes itself.
//
//   node examples/paywall.mjs [--chain sidestr:tally] [--port 8402] [--key-file paywall.key] [--asset SHELL] [--price 0.01]
//
// pay:  send 0.01 SHELL to the address it prints (the tally page's Assets → Send does it), note the txid
// sign: sidestr sign <txid> --key-file <the key that paid>          -> { pub, sig }
// ask:  curl "http://127.0.0.1:8402/text?txid=<txid>&pub=<pub>&sig=<sig>"
import { createServer } from 'node:http'; import { readFileSync, writeFileSync, existsSync } from 'node:fs'; import { randomBytes } from 'node:crypto';
import { openWallet } from '../index.mjs';
const argv = process.argv.slice(2); const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const chain = flag('chain', 'sidestr:tally'), port = Number(flag('port', 8402)), keyFile = flag('key-file', 'paywall.key'), ticker = flag('asset', 'SHELL'), priceText = flag('price', '0.01');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 }); const key = readFileSync(keyFile, 'utf8').trim();
const w = await openWallet({ chain, mirror: flag('mirror') }); const me = w.identity(key); const assets = w.ex.rules?.assets; if (!assets) throw new Error(`${chain} has no assets rule`);
const asset = [...assets.issued].find(([, a]) => a.ticker === ticker); if (!asset) throw new Error(`no asset ${ticker} on ${chain}`); const [assetId, meta] = asset;
const units = (t) => { const [i, f = ''] = String(t).split('.'); return Number(i + f.padEnd(meta.decimals, '0').slice(0, meta.decimals)); }; const price = units(priceText); const fmt = (n) => { const s = String(n).padStart(meta.decimals + 1, '0'); return meta.decimals ? `${s.slice(0, -meta.decimals)}.${s.slice(-meta.decimals)}` : s; };
const paid = new Set(); // txids already spent on a view, so one payment opens the door once
// what this key holds: sats, and the asset across its unspent coins
function balance() { let sats = 0, held = 0; for (const c of w.coins(me.script)) { sats += c.value; const m = assets.of(c.txid, c.vout); if (m?.has(assetId)) held += m.get(assetId); } return { sats, held }; }
// did `txid` pay at least `price` of the asset to me, and is `pub` a key that funded it? (its script is one of the inputs' scripts)
function check({ txid, pub, sig }) {
  if (!/^[0-9a-f]{64}$/i.test(txid ?? '') || !/^[0-9a-f]{64}$/i.test(pub ?? '') || !/^[0-9a-f]{128}$/i.test(sig ?? '')) return 'txid, pub and sig are hex (32, 32 and 64 bytes)';
  txid = txid.toLowerCase(); const t = w.ex.txs.get(txid); if (!t) return 'no such transaction on the chain yet (wait for its block)';
  let got = 0; t.tx.outputs.forEach((o, vout) => { if (o.scriptPubKey === me.script) { const m = assets.of(txid, vout); if (m?.has(assetId)) got += m.get(assetId); } }); if (got < price) return `that transaction paid ${fmt(got)} ${ticker}; the price is ${fmt(price)}`;
  const payer = '5120' + pub.toLowerCase(); const funded = t.tx.inputs.some((i) => w.ex.txs.get(i.prevout.txid)?.tx.outputs[i.prevout.vout]?.scriptPubKey === payer); if (!funded) return 'that key did not fund the payment';
  if (!w.secp.verifySchnorr(w.ex.hash.hexToBytes(txid), w.ex.hash.hexToBytes(sig), w.ex.hash.hexToBytes(pub))) return 'the signature over the txid does not verify';
  if (paid.has(txid)) return 'that payment was already used'; paid.add(txid); return null;
}
const TEXT = 'The paywall opened. This paragraph cost 0.01 SHELL on tally, verified by a node that validates every block itself, with no account and no oracle: the payment is on the chain, and the request was signed by the key that paid.\n';
createServer(async (req, res) => { const u = new URL(req.url, 'http://x'); const out = (code, body, type = 'text/plain') => { res.writeHead(code, { 'content-type': type + '; charset=utf-8' }); res.end(body); };
  if (u.pathname === '/') { await w.refresh().catch(() => {}); const b = balance(); return out(200, `paywall on ${chain} at block ${w.tip.height}\naddress ${me.address}\nprice ${fmt(price)} ${ticker} per view · signed by the key that paid\nbalance ${b.sats.toLocaleString('en-US')} sats · ${fmt(b.held)} ${ticker} received · ${paid.size} view(s) served\nGET /text?txid=&pub=&sig=\n`); }
  if (u.pathname === '/text') { await w.refresh().catch(() => {}); const why = check({ txid: u.searchParams.get('txid'), pub: u.searchParams.get('pub'), sig: u.searchParams.get('sig') }); return why ? out(402, why + '\n') : out(200, TEXT); }
  out(404, 'not here\n'); }).listen(port, '127.0.0.1', () => { const b = balance(); console.log(`paywall on ${chain} · address ${me.address} · price ${fmt(price)} ${ticker} · balance ${b.sats} sats, ${fmt(b.held)} ${ticker} · http://127.0.0.1:${port}/`); });
setInterval(async () => { try { await w.refresh(); const b = balance(); console.log(`${new Date().toTimeString().slice(0, 8)} block ${w.tip.height} · ${b.sats} sats · ${fmt(b.held)} ${ticker} · ${paid.size} view(s)`); } catch {} }, 60000);
