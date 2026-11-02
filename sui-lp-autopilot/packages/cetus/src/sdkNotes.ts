/**
 * Cetus DLMM SDK wiring notes (Stage 4).
 *
 * Install pin (cetus-skills 2026-10-21), now used by packages/cetus for reads and unsigned PTBs:
 *   @mysten/sui@2.31.2 blakejs @cetusprotocol/common-sdk@1.4.3 @cetusprotocol/dlmm-sdk@1.3.3
 *
 * Rules:
 * - MANUAL_SIGN builds PTBs with FullClient.sendSimulationTransaction, then returns BCS bytes.
 * - Never call FullClient.sendTransaction or signAndExecute. No keypair in this process.
 * - AUTO_GUARDED still needs Vault composition against published bytecode. See docs/VAULT_BYTECODE_FEASIBILITY.md.
 */
export const SDK_VERSION_PIN = {
	sui: '2.31.2',
	common: '1.4.3',
	dlmm: '1.3.3',
} as const
