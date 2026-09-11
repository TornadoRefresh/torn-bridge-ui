import { createPublicClient, createWalletClient, custom, http, type Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { ETH_CHAIN_ID, ETH_RPC, SOL_RPCS } from './config'

declare global {
  interface Window {
    ethereum?: any
    solana?: any
    phantom?: { solana?: any }
  }
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
  if (!window.ethereum) throw new Error('No Ethereum wallet found. Install MetaMask or Rabby.')
  const [account] = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as Address[]
  const chainIdHex = (await window.ethereum.request({ method: 'eth_chainId' })) as string
  if (parseInt(chainIdHex, 16) !== ETH_CHAIN_ID) {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + ETH_CHAIN_ID.toString(16) }] })
    } catch {
      throw new Error(`Please switch your wallet to ${evmChain.name}.`)
    }
  }
  return account
}

export function walletClient(account: Address) {
  return createWalletClient({ account, chain: evmChain, transport: custom(window.ethereum) })
}

function solProvider() {
  const p = window.phantom?.solana ?? window.solana
  if (!p) throw new Error('No Solana wallet found. Install Phantom.')
  return p
}

export async function connectSol(): Promise<PublicKey> {
  const p = solProvider()
  const res = await p.connect()
  return new PublicKey(res.publicKey?.toString() ?? p.publicKey.toString())
}

export async function signAndSendSol(tx: Transaction): Promise<string> {
  const p = solProvider()
  const { signature } = await p.signAndSendTransaction(tx)
  return signature as string
}
