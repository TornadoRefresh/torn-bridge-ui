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
  interface Window { ethereum?: any }
}

// ---------- chain clients ----------
export const evmChain = ETH_CHAIN_ID === 1 ? mainnet : sepolia
export const publicClient = createPublicClient({ chain: evmChain, transport: http(ETH_RPC) })
export const connections = SOL_RPCS.map((u) => new Connection(u, 'confirmed'))
export const connection = connections[0]
const SOL_CHAIN = NETWORK === 'mainnet' ? 'solana:mainnet' : 'solana:devnet'

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
let solSelected: { wallet: SolWallet; account: WalletAccount } | null = null
export let solWalletName = ''
export let solWalletIcon = ''

export async function connectSol(): Promise<PublicKey> {
  const options = solOptions()
  if (!options.length) throw new Error('No Solana wallet found. Install a Wallet Standard wallet (OKX, Phantom, Solflare, …).')
  const sel = await pickWallet('Solana wallet', options)
  const { accounts } = await sel.wallet.features[StandardConnect].connect()
  const account = accounts.find((a) => a.chains.includes(SOL_CHAIN)) ?? accounts[0]
  if (!account) throw new Error('No Solana account authorized')
  solSelected = { wallet: sel.wallet, account }; solWalletName = sel.name; solWalletIcon = sel.icon
  return new PublicKey(account.address)
}

export async function disconnectSol() {
  const w = solSelected?.wallet as (Wallet & { features: Partial<StandardDisconnectFeature> }) | undefined
  solSelected = null; solWalletName = ''; solWalletIcon = ''
  try { await w?.features[StandardDisconnect]?.disconnect() } catch { /* optional feature */ }
}

export async function signAndSendSol(tx: Transaction): Promise<string> {
  if (!solSelected) throw new Error('Solana wallet not connected')
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  const [out] = await solSelected.wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
    transaction: new Uint8Array(bytes), account: solSelected.account, chain: SOL_CHAIN,
  })
  return bs58.encode(out.signature)
}
