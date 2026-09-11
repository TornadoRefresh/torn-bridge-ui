import { BridgeAPI, ChainKind, createBridge, type OmniAddress, type TransferStatus } from '@omni-bridge/core'
import { createEvmBuilder } from '@omni-bridge/evm'
import { createSolanaBuilder } from '@omni-bridge/solana'
import { erc20Abi, type Address } from 'viem'
import { PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { NETWORK, TORN_ETH, ETH_RPC, SOL_RPC, KNOWN } from './config'
import { connection, latestBlockhash, publicClient, signAndSendSol, walletClient } from './wallets'

export const bridge = createBridge({ network: NETWORK, rpcUrls: { [ChainKind.Eth]: ETH_RPC, [ChainKind.Sol]: SOL_RPC } as any })
export const api = new BridgeAPI(NETWORK)
export const evm = createEvmBuilder({ network: NETWORK, chain: ChainKind.Eth })
export const sol = createSolanaBuilder({ network: NETWORK, connection })

export const tokenEth: OmniAddress = `eth:${TORN_ETH}`

let cachedMint: string | null | undefined

/**
 * The wrapped TORN mint on Solana as registered on the bridge contract.
 * Falls back to the known deployment if the RPC lookup fails. null = not deployed.
 */
export async function tornMint(): Promise<string | null> {
  if (cachedMint !== undefined) return cachedMint
  try {
    const bridged = await bridge.getBridgedToken(tokenEth, ChainKind.Sol)
    cachedMint = bridged ? bridged.replace(/^sol:/, '') : KNOWN.solMint
  } catch {
    cachedMint = KNOWN.solMint
  }
  return cachedMint
}

export async function ethBalance(owner: Address): Promise<bigint> {
  return publicClient.readContract({ address: TORN_ETH, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
}

export async function solBalance(owner: PublicKey): Promise<bigint> {
  const mint = await tornMint()
  if (!mint) return 0n
  const ata = await getAssociatedTokenAddress(new PublicKey(mint), owner)
  try {
    const b = await connection.getTokenAccountBalance(ata)
    return BigInt(b.value.amount)
  } catch {
    return 0n
  }
}

export interface Quote {
  tokenFee: bigint
  nativeFee: bigint
  usd?: number | null
}

export async function quote(sender: OmniAddress, recipient: OmniAddress, token: OmniAddress, amount: bigint): Promise<Quote> {
  const f = await api.getFee(sender, recipient, token, amount)
  return {
    tokenFee: BigInt((f as any).transferred_token_fee ?? 0),
    nativeFee: BigInt((f as any).native_token_fee ?? 0),
    usd: (f as any).usd_fee ?? null,
  }
}

export type Progress = (step: string) => void

/** Ethereum -> Solana. Returns the Ethereum tx hash. */
export async function sendEthToSol(from: Address, to: string, amount: bigint, q: Quote, onStep: Progress): Promise<string> {
  const recipient: OmniAddress = `sol:${to}`
  const sender: OmniAddress = `eth:${from}`
  onStep('Validating transfer')
  const validated = await bridge.validateTransfer({ token: tokenEth, amount, fee: q.tokenFee, nativeFee: q.nativeFee, sender, recipient })
  const wc = walletClient(from)
  const allowance = await publicClient.readContract({ address: TORN_ETH, abi: erc20Abi, functionName: 'allowance', args: [from, evm.bridgeAddress] })
  if (allowance < amount) {
    onStep('Approve TORN in your wallet')
    const a = evm.buildApproval(TORN_ETH, amount)
    const h = await wc.sendTransaction({ to: a.to, data: a.data, value: a.value })
    onStep('Waiting for approval confirmation')
    await publicClient.waitForTransactionReceipt({ hash: h })
  }
  onStep('Confirm the bridge transaction in your wallet')
  const t = evm.buildTransfer(validated)
  const hash = await wc.sendTransaction({ to: t.to, data: t.data, value: t.value })
  onStep('Submitted to Ethereum')
  return hash
}

/** Solana -> Ethereum. Returns the Solana signature. */
export async function sendSolToEth(from: PublicKey, to: Address, amount: bigint, q: Quote, onStep: Progress): Promise<string> {
  const mint = await tornMint()
  if (!mint) throw new Error('TORN is not deployed on Solana yet.')
  const token: OmniAddress = `sol:${mint}`
  onStep('Validating transfer')
  const validated = await bridge.validateTransfer({ token, amount, fee: q.tokenFee, nativeFee: q.nativeFee, sender: `sol:${from.toBase58()}`, recipient: `eth:${to}` })
  onStep('Building transaction')
  const ixs = await sol.buildTransfer(validated, from)
  const tx = new Transaction({ recentBlockhash: await latestBlockhash(), feePayer: from })
  tx.add(...ixs)
  onStep('Confirm the transaction in your wallet')
  const sig = await signAndSendSol(tx)
  onStep('Submitted to Solana')
  return sig
}

export async function status(txHash: string): Promise<TransferStatus | null> {
  try {
    const s = await api.getTransferStatus({ transactionHash: txHash } as any)
    return s[0] ?? null
  } catch {
    return null
  }
}
