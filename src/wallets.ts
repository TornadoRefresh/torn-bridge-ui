import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { ETH_CHAIN_ID, ETH_RPC, SOL_RPCS } from './config'

declare global {
  interface Window {
    ethereum?: any
    solana?: any
    phantom?: { solana?: any }
    /** OKX Wallet injects one object for both chains: EIP-1193 at the root, Phantom-compatible API under .solana */
    okxwallet?: any & { solana?: any }
  }
}

export type WalletName = 'OKX Wallet' | 'MetaMask / injected' | 'Phantom' | 'Solana (injected)'

/** EVM provider, preferring OKX Wallet when installed. */
export function evmProvider(): { provider: any; name: WalletName } {
  if (window.okxwallet?.request) return { provider: window.okxwallet, name: 'OKX Wallet' }
  if (window.ethereum) return { provider: window.ethereum, name: 'MetaMask / injected' }
  throw new Error('No Ethereum wallet found. Install OKX Wallet or MetaMask.')
}

/** Solana provider, preferring OKX Wallet when installed. */
export function solProvider(): { provider: any; name: WalletName } {
  if (window.okxwallet?.solana) return { provider: window.okxwallet.solana, name: 'OKX Wallet' }
  if (window.phantom?.solana) return { provider: window.phantom.solana, name: 'Phantom' }
  if (window.solana) return { provider: window.solana, name: 'Solana (injected)' }
  throw new Error('No Solana wallet found. Install OKX Wallet or Phantom.')
}

export const evmChain = ETH_CHAIN_ID === 1 ? mainnet : sepolia
export const publicClient = createPublicClient({ chain: evmChain, transport: http(ETH_RPC) })
export const connections = SOL_RPCS.map((u) => new Connection(u, 'confirmed'))
export const connection = connections[0]

/** Fresh blockhash from the first RPC that answers. */
export async function latestBlockhash(): Promise<string> {
  let lastErr: unknown
  for (const c of connections) {
    try { return (await c.getLatestBlockhash('confirmed')).blockhash } catch (e) { lastErr = e }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Solana RPCs failed')
}

export async function connectEvm(): Promise<Address> {
  const { provider } = evmProvider()
  const [account] = (await provider.request({ method: 'eth_requestAccounts' })) as Address[]
  const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
  if (parseInt(chainIdHex, 16) !== ETH_CHAIN_ID) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + ETH_CHAIN_ID.toString(16) }] })
    } catch {
      throw new Error(`Please switch your wallet to ${evmChain.name}.`)
    }
  }
  return account
}

export function walletClient(account: Address) {
  return createWalletClient({ account, chain: evmChain, transport: custom(evmProvider().provider) })
}

export function onEvmEvents(onAccounts: (a: string[]) => void, onChain: () => void) {
  try {
    const { provider } = evmProvider()
    provider.on?.('accountsChanged', onAccounts)
    provider.on?.('chainChanged', onChain)
  } catch { /* no wallet installed */ }
}

export async function connectSol(): Promise<PublicKey> {
  const { provider } = solProvider()
  const res = await provider.connect()
  return new PublicKey((res?.publicKey ?? provider.publicKey).toString())
}

export async function signAndSendSol(tx: Transaction): Promise<string> {
  const { provider } = solProvider()
  const res = await provider.signAndSendTransaction(tx)
  return (typeof res === 'string' ? res : res.signature) as string
}

/** Names of the wallets detected on this page, for display. */
export function detectedWallets(): string {
  const names = new Set<string>()
  try { names.add(evmProvider().name) } catch {}
  try { names.add(solProvider().name) } catch {}
  return names.size ? [...names].join(' · ') : 'no wallet detected'
}
