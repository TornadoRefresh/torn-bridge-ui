import './style.css'
import { formatUnits, parseUnits, isAddress, type Address } from 'viem'
import { PublicKey } from '@solana/web3.js'
import { NETWORK, TORN_ETH, ETH_DECIMALS, SOL_DECIMALS, EXPLORER, KNOWN } from './config'
import { connectEvm, connectSol, disconnectEvm, disconnectSol, evmWalletIcon, evmWalletName, onEvmEvents, solWalletIcon, solWalletName } from './wallets'
import { ethBalance, solBalance, quote, sendEthToSol, sendSolToEth, status, tornMint, evm, type Quote } from './bridge'

type Dir = 'eth2sol' | 'sol2eth'
interface HistoryItem { dir: Dir; hash: string; amount: string; ts: number; status?: string }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
const app = $('#app')
const HKEY = `torn-bridge-history-${NETWORK}`

let dir: Dir = 'eth2sol'
let evmAccount: Address | null = null
let solAccount: PublicKey | null = null
let balance = 0n
let currentQuote: Quote | null = null
let quoteTimer: number | undefined
let busy = false

app.innerHTML = `
<div class="wrapper">
  <header class="header"><div class="container">
    <a class="brand" href="https://tornadocash.eth.limo" target="_blank" rel="noopener"><img src="/logo.svg" alt="" /><span>tornado</span></a>
    <nav class="nav"><a href="https://tornadocash.eth.limo" target="_blank" rel="noopener">App</a><a href="https://etherscan.io/token/${TORN_ETH}" target="_blank" rel="noopener">TORN</a><a href="https://github.com/Near-One/omni-bridge" target="_blank" rel="noopener">Omni Bridge</a></nav>
    <span class="network-tag ${NETWORK}"><span class="dot"></span>${NETWORK === 'mainnet' ? 'Ethereum ↔ Solana' : 'Sepolia ↔ Devnet'}</span>
  </div></header>

  <main class="main"><div class="container"><div class="grid">
    <section>
      <div class="tabs">
        <div class="tab left is-active" data-dir="eth2sol">To Solana</div>
        <div class="tab right" data-dir="sol2eth">To Ethereum</div>
      </div>
      <div class="box">
        <div class="route">
          <div class="chain"><span class="chain-icon" id="from-icon">Ξ</span><span id="from-name">Ethereum</span></div>
          <span class="arrow">→</span>
          <div class="chain"><span class="chain-icon" id="to-icon">◎</span><span id="to-name">Solana</span></div>
        </div>

        <div class="wallet-row hidden" id="wallet-row"></div>

        <div id="not-deployed" class="notice is-warning hidden">TORN is not registered on Omni Bridge for this network yet. Run the registration scripts first.</div>

        <div class="field">
          <div class="label"><span>Amount</span><span class="hint" id="balance">—</span></div>
          <div class="control"><input class="input" id="amount" inputmode="decimal" placeholder="0.0" autocomplete="off" /><span class="suffix">TORN</span></div>
        </div>

        <div class="field">
          <div class="label"><span id="recipient-label">Recipient (Solana address)</span><button class="link hidden" id="use-mine">use connected wallet</button></div>
          <div class="control"><input class="input" id="recipient" placeholder="" autocomplete="off" spellcheck="false" /></div>
        </div>

        <div class="summary" id="summary">
          <div class="row"><span>Relayer fee</span><span id="fee">—</span></div>
          <div class="row"><span>You receive</span><span id="receive">—</span></div>
          <div class="row muted"><span>Estimated time</span><span id="eta">~20 min</span></div>
        </div>

        <div id="error" class="notice is-danger hidden"></div>
        <ul class="steps hidden" id="steps"></ul>

        <button class="button is-primary" id="action">Bridge</button>
      </div>
    </section>

    <aside>
      <div class="box plain">
        <h2 class="box-title">Bridge</h2>
        <div class="stats">
          <div class="k">Token</div><div class="v"><a href="${EXPLORER.eth}/token/${TORN_ETH}" target="_blank" rel="noopener">TORN</a> · ${TORN_ETH.slice(0, 6)}…${TORN_ETH.slice(-4)}</div>
          <div class="k">Solana mint</div><div class="v" id="mint">loading…</div>
          ${KNOWN.nearToken ? `<div class="k">NEAR token</div><div class="v plain"><a href="${EXPLORER.nearAccount(KNOWN.nearToken)}" target="_blank" rel="noopener">${KNOWN.nearToken.slice(0, 10)}…factory.bridge.near</a></div>` : ''}
          <div class="k">Bridge contract</div><div class="v plain"><a href="${EXPLORER.eth}/address/${evm.bridgeAddress}" target="_blank" rel="noopener">${evm.bridgeAddress.slice(0, 6)}…${evm.bridgeAddress.slice(-4)}</a></div>
          <div class="k">Decimals</div><div class="v plain">18 on Ethereum · 9 on Solana</div>
          <div class="k">Security</div><div class="v plain">Lock &amp; mint via NEAR Omni Bridge (light client + MPC)</div>
        </div>
      </div>
      <div class="box plain" style="margin-top:1.25rem">
        <h2 class="box-title">Your transfers</h2>
        <div class="history" id="history"></div>
      </div>
    </aside>
  </div></div></main>

  <footer class="footer"><div class="container">
    <span>TORN Bridge · powered by <a href="https://github.com/Near-One/omni-bridge" target="_blank" rel="noopener">Omni Bridge</a></span>
    <span>Transfers take ~20 min (Ethereum finality). Funds are never custodied by this page.</span>
  </div></footer>
</div>`

const amountEl = $<HTMLInputElement>('#amount')
const recipientEl = $<HTMLInputElement>('#recipient')
const actionBtn = $<HTMLButtonElement>('#action')
const errorEl = $('#error')
const stepsEl = $('#steps')

function showError(msg: string | null) {
  errorEl.textContent = msg ?? ''
  errorEl.classList.toggle('hidden', !msg)
}

function decimals() { return dir === 'eth2sol' ? ETH_DECIMALS : SOL_DECIMALS }
function fmt(v: bigint, d = decimals()) { const s = formatUnits(v, d); return s.includes('.') ? s.replace(/\.?0+$/, '') : s }

function parseAmount(): bigint | null {
  const raw = amountEl.value.trim()
  if (!raw) return null
  try { const v = parseUnits(raw, decimals()); return v > 0n ? v : null } catch { return null }
}

function recipientValid(): boolean {
  const r = recipientEl.value.trim()
  if (!r) return false
  if (dir === 'eth2sol') { try { new PublicKey(r); return true } catch { return false } }
  return isAddress(r)
}

function setDir(d: Dir) {
  dir = d
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.dir === d))
  const eth2sol = d === 'eth2sol'
  $('#from-name').textContent = eth2sol ? 'Ethereum' : 'Solana'
  $('#to-name').textContent = eth2sol ? 'Solana' : 'Ethereum'
  $('#from-icon').textContent = eth2sol ? 'Ξ' : '◎'
  $('#to-icon').textContent = eth2sol ? '◎' : 'Ξ'
  $('#recipient-label').textContent = eth2sol ? 'Recipient (Solana address)' : 'Recipient (Ethereum address)'
  recipientEl.placeholder = eth2sol ? 'Solana address' : '0x…'
  $('#eta').textContent = eth2sol ? '~20 min' : '~5 min'
  recipientEl.value = ''
  currentQuote = null
  showError(null)
  refresh()
}

async function refresh() {
  const connected = dir === 'eth2sol' ? !!evmAccount : !!solAccount
  try {
    balance = !connected ? 0n : dir === 'eth2sol' ? await ethBalance(evmAccount!) : await solBalance(solAccount!)
  } catch { balance = 0n }
  $('#balance').textContent = connected ? `Balance: ${fmt(balance)} TORN` : '—'
  renderWalletBar()
  updateAction()
  scheduleQuote()
}

function updateAction() {
  const connected = dir === 'eth2sol' ? !!evmAccount : !!solAccount
  const amt = parseAmount()
  if (busy) { actionBtn.disabled = true; return }
  if (!connected) { actionBtn.textContent = dir === 'eth2sol' ? 'Connect Ethereum wallet' : 'Connect Solana wallet'; actionBtn.disabled = false; return }
  if (!amt) { actionBtn.textContent = 'Enter amount'; actionBtn.disabled = true; return }
  if (amt > balance) { actionBtn.textContent = 'Insufficient balance'; actionBtn.disabled = true; return }
  if (!recipientValid()) { actionBtn.textContent = 'Enter recipient'; actionBtn.disabled = true; return }
  if (!currentQuote) { actionBtn.textContent = 'Fetching fee…'; actionBtn.disabled = true; return }
  actionBtn.textContent = dir === 'eth2sol' ? 'Bridge to Solana' : 'Bridge to Ethereum'
  actionBtn.disabled = false
}

function scheduleQuote() {
  clearTimeout(quoteTimer)
  currentQuote = null
  $('#fee').textContent = '—'; $('#receive').textContent = '—'
  const amt = parseAmount()
  if (!amt || !recipientValid()) { updateAction(); return }
  quoteTimer = window.setTimeout(fetchQuote, 400)
}

async function fetchQuote() {
  const amt = parseAmount()
  if (!amt || !recipientValid()) return
  const to = recipientEl.value.trim()
  try {
    let q: Quote
    if (dir === 'eth2sol') {
      const from = evmAccount ?? '0x0000000000000000000000000000000000000001'
      q = await quote(`eth:${from}`, `sol:${to}`, `eth:${TORN_ETH}`, amt)
    } else {
      const mint = await tornMint()
      if (!mint) throw new Error('TORN is not deployed on Solana yet.')
      const from = solAccount?.toBase58() ?? '11111111111111111111111111111111'
      q = await quote(`sol:${from}`, `eth:${to}`, `sol:${mint}`, amt)
    }
    currentQuote = q
    const native = dir === 'eth2sol' ? `${fmt(q.nativeFee, 18)} ETH` : `${fmt(q.nativeFee, 9)} SOL`
    const parts = []
    if (q.nativeFee > 0n) parts.push(native)
    if (q.tokenFee > 0n) parts.push(`${fmt(q.tokenFee)} TORN`)
    $('#fee').textContent = (parts.join(' + ') || 'free') + (q.usd != null ? ` (≈$${Number(q.usd).toFixed(3)})` : '')
    const recv = amt - q.tokenFee
    // amounts are truncated to the destination precision
    const destDec = dir === 'eth2sol' ? SOL_DECIMALS : ETH_DECIMALS
    const unit = 10n ** BigInt(Math.max(0, decimals() - destDec))
    $('#receive').textContent = `${fmt((recv / unit) * unit)} TORN`
    showError(null)
  } catch (e: any) {
    currentQuote = null
    showError(e?.message?.replace(/^Error:\s*/, '') ?? String(e))
  }
  updateAction()
}

function setSteps(list: string[], activeIdx: number) {
  stepsEl.classList.remove('hidden')
  stepsEl.innerHTML = list.map((s, i) => `<li class="${i < activeIdx ? 'done' : i === activeIdx ? 'active' : ''}">${s}</li>`).join('')
}

/** Shows the wallet of the current source chain with a disconnect link. */
function renderWalletBar() {
  const el = $('#wallet-row')
  const eth2sol = dir === 'eth2sol'
  const addr = eth2sol ? evmAccount : solAccount?.toBase58() ?? null
  const name = eth2sol ? evmWalletName : solWalletName
  const icon = eth2sol ? evmWalletIcon : solWalletIcon
  el.classList.toggle('hidden', !addr)
  if (!addr) { el.innerHTML = ''; return }
  el.innerHTML = `${icon ? `<img src="${icon}" alt="" />` : `<span class="chain-icon">${eth2sol ? 'Ξ' : '◎'}</span>`}<span class="wallet-name">${name}</span><span class="wallet-addr" title="${addr}">${addr.slice(0, 6)}…${addr.slice(-4)}</span><button class="link wallet-disconnect">disconnect</button>`
  el.querySelector('.wallet-disconnect')!.addEventListener('click', eth2sol ? doDisconnectEvm : doDisconnectSol)
  // "use connected wallet" only makes sense when the other chain's wallet is connected
  $('#use-mine').classList.toggle('hidden', eth2sol ? !solAccount : !evmAccount)
}

async function doConnectEvm() {
  showError(null)
  try {
    evmAccount = await connectEvm()
    onEvmEvents((a) => { evmAccount = (a[0] as Address) ?? null; refresh() }, () => location.reload())
  } catch (e: any) { showError(e?.message ?? String(e)) }
  await refresh()
}
async function doDisconnectEvm() { await disconnectEvm(); evmAccount = null; await refresh() }
async function doConnectSol() {
  showError(null)
  try { solAccount = await connectSol() } catch (e: any) { showError(e?.message ?? String(e)) }
  await refresh()
}
async function doDisconnectSol() { await disconnectSol(); solAccount = null; await refresh() }

function loadHistory(): HistoryItem[] { try { return JSON.parse(localStorage.getItem(HKEY) || '[]') } catch { return [] } }
function saveHistory(h: HistoryItem[]) { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 20))) } catch {} }

function renderHistory() {
  const h = loadHistory()
  const el = $('#history')
  if (!h.length) { el.innerHTML = '<div class="empty">No transfers yet.</div>'; return }
  el.innerHTML = h.map((it) => {
    const link = it.dir === 'eth2sol' ? `${EXPLORER.eth}/tx/${it.hash}` : EXPLORER.sol(it.hash)
    const st = it.status ?? 'Pending'
    const done = st === 'Finalised' || st === 'Settled' || st === 'FastFinalised'
    return `<div class="row"><span class="dir">${it.dir === 'eth2sol' ? 'ETH → SOL' : 'SOL → ETH'}</span><a href="${link}" target="_blank" rel="noopener">${it.amount} TORN · ${it.hash.slice(0, 10)}…</a><span class="st ${done ? '' : 'pending'}">${done ? 'Done' : st}</span></div>`
  }).join('')
}

async function pollHistory() {
  const h = loadHistory()
  let changed = false
  for (const it of h) {
    if (it.status === 'Finalised' || it.status === 'Settled' || it.status === 'FastFinalised') continue
    const s = await status(it.hash)
    if (s && s !== it.status) { it.status = s; changed = true }
  }
  if (changed) { saveHistory(h); renderHistory() }
}

async function onAction() {
  showError(null)
  if (dir === 'eth2sol' && !evmAccount) return doConnectEvm()
  if (dir === 'sol2eth' && !solAccount) return doConnectSol()
  try {
    const amt = parseAmount()!
    const to = recipientEl.value.trim()
    const q = currentQuote!
    busy = true; updateAction()
    const steps = dir === 'eth2sol'
      ? ['Validate', 'Approve TORN', 'Sign bridge transaction', 'Ethereum confirmed → NEAR light client (~16 min)', 'Minted on Solana']
      : ['Validate', 'Sign transaction', 'Solana confirmed → Wormhole → NEAR', 'Released on Ethereum']
    setSteps(steps, 0)
    const onStep = (s: string) => {
      const idx = /approv/i.test(s) ? 1 : /confirm|sign/i.test(s) ? (dir === 'eth2sol' ? 2 : 1) : /submitted/i.test(s) ? (dir === 'eth2sol' ? 3 : 2) : 0
      setSteps(steps, idx)
    }
    const hash = dir === 'eth2sol'
      ? await sendEthToSol(evmAccount!, to, amt, q, onStep)
      : await sendSolToEth(solAccount!, to as Address, amt, q, onStep)
    const h = loadHistory(); h.unshift({ dir, hash, amount: fmt(amt), ts: Date.now(), status: 'Initialised' }); saveHistory(h); renderHistory()
    amountEl.value = ''
    busy = false
    await refresh()
    // keep polling this transfer
    const total = steps.length
    const tick = async () => {
      const s = await status(hash)
      const idx = s === 'Finalised' || s === 'Settled' ? total : s === 'FinalisedOnNear' || s === 'Signed' ? total - 1 : total - 2
      setSteps(steps, idx)
      if (idx < total) setTimeout(tick, 15000)
      pollHistory()
    }
    setTimeout(tick, 15000)
  } catch (e: any) {
    busy = false
    stepsEl.classList.add('hidden')
    showError(e?.shortMessage || e?.message || String(e))
    updateAction()
  }
}

document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.addEventListener('click', () => setDir(t.dataset.dir as Dir)))
amountEl.addEventListener('input', scheduleQuote)
recipientEl.addEventListener('input', scheduleQuote)
actionBtn.addEventListener('click', onAction)
$('#use-mine').addEventListener('click', async (e) => {
  e.preventDefault()
  try {
    if (dir === 'eth2sol') { if (!solAccount) await doConnectSol(); if (solAccount) recipientEl.value = solAccount.toBase58() }
    else { if (!evmAccount) await doConnectEvm(); if (evmAccount) recipientEl.value = evmAccount }
    scheduleQuote()
  } catch (err: any) { showError(err?.message ?? String(err)) }
})

;(async () => {
  renderHistory()
  const mint = await tornMint()
  $('#mint').innerHTML = mint ? `<a href="${EXPLORER.solToken(mint)}" target="_blank" rel="noopener">${mint.slice(0, 6)}…${mint.slice(-4)}</a>` : 'not deployed yet'
  $('#not-deployed').classList.toggle('hidden', !!mint)
  setDir('eth2sol')
  pollHistory(); setInterval(pollHistory, 30000)
})()
