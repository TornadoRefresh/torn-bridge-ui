import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { createStore, type EIP6963ProviderDetail } from 'mipd'
import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { StandardConnect, StandardDisconnect, type StandardConnectFeature, type StandardDisconnectFeature } from '@wallet-standard/features'
import { SolanaSignAndSendTransaction, type SolanaSignAndSendTransactionFeature } from '@solana/wallet-standard-features'
import bs58 from 'bs58'
import { ETH_CHAIN_ID, ETH_RPC, NETWORK, SOL_RPCS } from './config'

declare global {
  interface Window { ethereum?: any; solana?: any; phantom?: { solana?: any }; okxwallet?: any }
}

// ---------- chain clients ----------
export const evmChain = ETH_CHAIN_ID === 1 ? mainnet : sepolia
export const publicClient = createPublicClient({ chain: evmChain, transport: http(ETH_RPC) })
export const connections = SOL_RPCS.map((u) => new Connection(u, 'confirmed'))
export const connection = connections[0]
const SOL_CHAIN = NETWORK === 'mainnet' ? 'solana:mainnet' : 'solana:devnet'

/** Run a read against each RPC in turn until one answers. */
export async function withConnection<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (const c of connections) {
    try { return await fn(c) } catch (e) { lastErr = e }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Solana RPCs failed')
}

/** Fresh blockhash from the first RPC that answers. */
export async function latestBlockhash(): Promise<string> {
  let lastErr: unknown
  for (const c of connections) {
    try { return (await c.getLatestBlockhash('confirmed')).blockhash } catch (e) { lastErr = e }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Solana RPCs failed')
}

// ---------- wallet discovery (EIP-6963 for EVM, Wallet Standard for Solana) ----------
const evmStore = createStore()          // listens for eip6963:announceProvider
const solRegistry = getWallets()        // window.navigator.wallets

export interface WalletOption { id: string; name: string; icon: string }

function evmOptions(): (WalletOption & { detail: EIP6963ProviderDetail })[] {
  const list: (WalletOption & { detail: EIP6963ProviderDetail })[] = evmStore.getProviders().map((d) => ({ id: d.info.rdns, name: d.info.name, icon: d.info.icon as string, detail: d }))
  if (!list.length && window.ethereum) {
    // Legacy wallets that only inject window.ethereum without EIP-6963 announcements
    const detail = { info: { uuid: 'injected', name: 'Injected wallet', icon: '', rdns: 'injected' }, provider: window.ethereum } as unknown as EIP6963ProviderDetail
    list.push({ id: 'injected', name: 'Injected wallet', icon: '', detail })
  }
  return list
}

type SolWallet = Wallet & { features: StandardConnectFeature & SolanaSignAndSendTransactionFeature }
function solOptions(): (WalletOption & { wallet: SolWallet })[] {
  return solRegistry.get()
    .filter((w) => w.chains.includes(SOL_CHAIN) && StandardConnect in w.features && SolanaSignAndSendTransaction in w.features)
    .map((w) => ({ id: w.name, name: w.name, icon: w.icon, wallet: w as SolWallet }))
}

/** Minimal picker. Resolves immediately when only one wallet is available. */
function pickWallet<T extends WalletOption>(title: string, options: T[]): Promise<T> {
  if (options.length === 1) return Promise.resolve(options[0])
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `<div class="box plain modal-box"><h2 class="box-title">${title}</h2><div class="wallet-list"></div><button class="button is-small modal-close">Cancel</button></div>`
    const list = overlay.querySelector('.wallet-list')!
    for (const o of options) {
      const b = document.createElement('button')
      b.className = 'button wallet-item'
      b.innerHTML = `${o.icon ? `<img src="${o.icon}" alt="" />` : ''}<span>${o.name}</span>`
      b.onclick = () => { overlay.remove(); resolve(o) }
      list.appendChild(b)
    }
    const close = () => { overlay.remove(); reject(new Error('Wallet selection cancelled')) }
    overlay.querySelector('.modal-close')!.addEventListener('click', close)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
    document.body.appendChild(overlay)
  })
}

// ---------- EVM ----------
let evmSelected: EIP6963ProviderDetail | null = null
export let evmWalletName = ''
export let evmWalletIcon = ''

export async function connectEvm(): Promise<Address> {
  const options = evmOptions()
  if (!options.length) throw new Error('No Ethereum wallet found. Install a browser wallet (OKX, MetaMask, Rabby, …).')
  const sel = await pickWallet('Ethereum wallet', options)
  const provider = sel.detail.provider as any
  const [account] = (await provider.request({ method: 'eth_requestAccounts' })) as Address[]
  const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
  if (parseInt(chainIdHex, 16) !== ETH_CHAIN_ID) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + ETH_CHAIN_ID.toString(16) }] })
    } catch {
      throw new Error(`Please switch ${sel.name} to ${evmChain.name}.`)
    }
  }
  evmSelected = sel.detail; evmWalletName = sel.name; evmWalletIcon = sel.icon
  return account
}

/** Forget the EVM wallet; also asks the wallet to revoke permissions when it supports EIP-2255 revocation. */
export async function disconnectEvm() {
  const p = evmSelected?.provider as any
  evmSelected = null; evmWalletName = ''; evmWalletIcon = ''
  try { await p?.request?.({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }) } catch { /* optional */ }
}

export function walletClient(account: Address) {
  if (!evmSelected) throw new Error('Ethereum wallet not connected')
  return createWalletClient({ account, chain: evmChain, transport: custom(evmSelected.provider as any) })
}

export function onEvmEvents(onAccounts: (a: string[]) => void, onChain: () => void) {
  const p = evmSelected?.provider as any
  p?.on?.('accountsChanged', onAccounts)
  p?.on?.('chainChanged', onChain)
}

// ---------- Solana ----------
/** Phantom-style injected provider (window.solana etc.), used only when Wallet Standard connect yields no Solana account. */
type LegacySol = { connect(): Promise<any>; publicKey?: any; signAndSendTransaction(tx: Transaction): Promise<any> }
function legacySolProviders(): { name: string; provider: LegacySol }[] {
  const out: { name: string; provider: LegacySol }[] = []
  if (window.okxwallet?.solana) out.push({ name: 'OKX Wallet', provider: window.okxwallet.solana })
  if (window.phantom?.solana) out.push({ name: 'Phantom', provider: window.phantom.solana })
  if (window.solana && !out.some((o) => o.provider === window.solana)) out.push({ name: 'Solana (injected)', provider: window.solana })
  return out
}
let solLegacy: LegacySol | null = null

let solSelected: { wallet: SolWallet; account: WalletAccount } | null = null
export let solWalletName = ''
export let solWalletIcon = ''

export async function connectSol(): Promise<PublicKey> {
  const options = solOptions()
  console.info('[wallet] wallet-standard registry', solRegistry.get().map((w) => ({ name: w.name, chains: w.chains, features: Object.keys(w.features) })))
  solLegacy = null
  if (options.length) {
    const sel = await pickWallet('Solana wallet', options)
    let accounts: readonly WalletAccount[] = []
    try { accounts = (await sel.wallet.features[StandardConnect].connect()).accounts } catch (e) { console.warn('[wallet] wallet-standard connect failed', e) }
    console.info('[wallet] solana connect result', accounts.map((a) => ({ address: a.address, chains: a.chains })))
    const solAccounts = accounts.filter((a) => a.chains.some((c) => c.startsWith('solana:')))
    const account = solAccounts.find((a) => a.chains.includes(SOL_CHAIN)) ?? solAccounts[0]
    if (account) {
      try {
        const pk = new PublicKey(account.address)
        solSelected = { wallet: sel.wallet, account }; solWalletName = sel.name; solWalletIcon = sel.icon
        return pk
      } catch { console.warn('[wallet] unexpected address from wallet standard', account.address) }
    }
  }
  // Fallback: Phantom-style injected API (some wallets only expose Solana here for imported keys)
  const legacy = legacySolProviders()
  if (!legacy.length) throw new Error(options.length ? 'The wallet returned no Solana account. Select a Solana address for this site in the wallet and try again.' : 'No Solana wallet found. Install OKX Wallet, Phantom or Solflare.')
  const pick = legacy.length === 1 ? legacy[0] : await pickWallet('Solana wallet', legacy.map((l) => ({ id: l.name, name: l.name, icon: '', provider: l.provider })))
  const res = await pick.provider.connect()
  const pkStr = (res?.publicKey ?? pick.provider.publicKey)?.toString()
  if (!pkStr) throw new Error(`${pick.name} did not return a Solana account`)
  console.info('[wallet] solana connected via injected API', pick.name, pkStr)
  solLegacy = pick.provider; solSelected = null; solWalletName = pick.name; solWalletIcon = ''
  return new PublicKey(pkStr)
}

export async function disconnectSol() {
  const w = solSelected?.wallet as (Wallet & { features: Partial<StandardDisconnectFeature> }) | undefined
  const l = solLegacy as any
  solSelected = null; solLegacy = null; solWalletName = ''; solWalletIcon = ''
  try { await l?.disconnect?.() } catch { /* optional */ }
  try { await w?.features[StandardDisconnect]?.disconnect() } catch { /* optional feature */ }
}

export async function signAndSendSol(tx: Transaction): Promise<string> {
  if (solLegacy) {
    const res = await solLegacy.signAndSendTransaction(tx)
    return typeof res === 'string' ? res : res.signature
  }
  if (!solSelected) throw new Error('Solana wallet not connected')
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  const [out] = await solSelected.wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
    transaction: new Uint8Array(bytes), account: solSelected.account, chain: SOL_CHAIN,
  })
  return bs58.encode(out.signature)
}
