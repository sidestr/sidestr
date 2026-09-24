#!/usr/bin/env node
// A paywall that trusts nothing but the chain: it validates tally itself, watches its own address, and opens
// one route to whoever paid it 0.01 SHELL and can sign the payment's txid with the key that paid.
// Ephemeral by design: no dependency beyond this package, no state beyond the chain, a key file it makes itself.
//
//   node examples/paywall/paywall.mjs [--chain sidestr:tally] [--port 8402] [--key-file paywall.key] [--asset SHELL] [--price 0.01]
//
// pay:  send 0.01 SHELL to the address it prints (the tally page's Assets → Send does it), note the txid
// sign: sidestr sign <txid> --key-file <the key that paid>          -> { pub, sig }
// ask:  curl "http://127.0.0.1:8402/text?txid=<txid>&pub=<pub>&sig=<sig>"
import { createServer } from 'node:http'; import { readFileSync, writeFileSync, existsSync } from 'node:fs'; import { randomBytes } from 'node:crypto';
import { openWallet } from '../../index.mjs';
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
// the front page: status, and a form that signs the txid in the browser with a pasted key (the key never leaves the page)
const LIB = 'https://cdn.jsdelivr.net/gh/sidestr/spec@373d3eb6accd163f418e8a813052f1516a942bb3/siding/lib', CDN = 'https://cdn.jsdelivr.net/gh/bitcoin-desktop/schema@v0.0.27';
const page = ({ b }) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>paywall · ${chain}</title>
<style>body{font:15px/1.5 -apple-system,Inter,Segoe UI,sans-serif;background:#0b0d12;color:#eef1f7;max-width:640px;margin:2rem auto;padding:0 1rem}.mono{font-family:ui-monospace,Menlo,monospace;font-size:.85rem;word-break:break-all}.mut{color:#8b93a7}input{width:100%;font:inherit;background:#1d2331;color:#eef1f7;border:1px solid #262d3d;border-radius:10px;padding:.6rem .7rem;margin:.3rem 0 .8rem}button{font:inherit;font-weight:600;background:#7c5cff;color:#fff;border:0;border-radius:10px;padding:.7rem 1.1rem;cursor:pointer}#out{margin-top:1rem;padding:1rem;border:1px solid #262d3d;border-radius:12px;background:#151923;white-space:pre-wrap}.good{color:#34d399}.bad{color:#f87171}</style>
<h1 style="font-size:1.3rem">a paywall on ${chain}</h1>
<p class="mut">${fmt(price)} ${ticker} per view. Pay the address below from the tally page (Assets → Send), then sign the payment's txid here with the key that paid. The key is used in this page only and never sent.</p>
<div>address <div class="mono">${me.address}</div></div>
<p class="mut">block ${w.tip.height} · balance ${b.sats.toLocaleString('en-US')} sats · ${fmt(b.held)} ${ticker} received · ${paid.size} view(s) served</p>
<label>txid of your payment<input id="txid" class="mono" autocomplete="off" placeholder="64 hex characters"></label>
<label>the key that paid (64 hex characters)<input id="key" type="password" autocomplete="off"></label>
<button id="go">sign and open</button><div id="out" class="mut">nothing yet</div>
<script type="module">
import { makeSigner } from '${LIB}/schnorr.mjs'; const hash = await import('${CDN}/codec/hash.js'); const secp = await import('${CDN}/codec/secp256k1.js'); const signer = makeSigner({ hash, secp });
const out = document.getElementById('out'); document.getElementById('go').onclick = async () => { const txid = document.getElementById('txid').value.trim().toLowerCase(), key = document.getElementById('key').value.trim().toLowerCase();
  try { if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('the txid is 64 hex characters'); if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('the key is 64 hex characters'); const pub = signer.pubkeyOf(key); const sig = hash.bytesToHex(signer.schnorrSign(hash.hexToBytes(txid), key));
    out.className = 'mut'; out.textContent = 'signed as ' + pub.slice(0, 12) + '…, asking…'; const r = await fetch('/text?txid=' + txid + '&pub=' + pub + '&sig=' + sig); const t = await r.text(); out.className = r.ok ? 'good' : 'bad'; out.textContent = t; } catch (e) { out.className = 'bad'; out.textContent = e.message; } };
</script>`;
const TEXT = 'The paywall opened. This paragraph cost 0.01 SHELL on tally, verified by a node that validates every block itself, with no account and no oracle: the payment is on the chain, and the request was signed by the key that paid.\n';
createServer(async (req, res) => { const u = new URL(req.url, 'http://x'); const out = (code, body, type = 'text/plain') => { res.writeHead(code, { 'content-type': type + '; charset=utf-8' }); res.end(body); };
  if (u.pathname === '/status') { await w.refresh().catch(() => {}); const b = balance(); return out(200, `paywall on ${chain} at block ${w.tip.height}\naddress ${me.address}\nprice ${fmt(price)} ${ticker} per view · signed by the key that paid\nbalance ${b.sats.toLocaleString('en-US')} sats · ${fmt(b.held)} ${ticker} received · ${paid.size} view(s) served\nGET /text?txid=&pub=&sig=\n`); }
  if (u.pathname === '/') { await w.refresh().catch(() => {}); const b = balance(); return out(200, page({ b }), 'text/html'); }
  if (u.pathname === '/text') { await w.refresh().catch(() => {}); const why = check({ txid: u.searchParams.get('txid'), pub: u.searchParams.get('pub'), sig: u.searchParams.get('sig') }); return why ? out(402, why + '\n') : out(200, TEXT); }
  out(404, 'not here\n'); }).listen(port, '127.0.0.1', () => { const b = balance(); console.log(`paywall on ${chain} · address ${me.address} · price ${fmt(price)} ${ticker} · balance ${b.sats} sats, ${fmt(b.held)} ${ticker} · http://127.0.0.1:${port}/`); });
setInterval(async () => { try { await w.refresh(); const b = balance(); console.log(`${new Date().toTimeString().slice(0, 8)} block ${w.tip.height} · ${b.sats} sats · ${fmt(b.held)} ${ticker} · ${paid.size} view(s)`); } catch {} }, 60000);
