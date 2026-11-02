/**
 * Future dust test. Nothing here builds, signs, or submits a transaction.
 * Each mutating step still needs a separate OWNER confirmation in the wallet.
 */
export const MICROTEST_PLAN = {
	name: 'OPEN → MONITOR → CLOSE → VERIFY',
	network: 'mainnet',
	autoExecute: false,
	spendsFunds: false,
	steps: [
		{
			id: 'open',
			action: 'Build an unsigned SELL or BUY open preview and stop. The OWNER signs only after a separate approval.',
			requiresOwnerConfirmation: true,
			submit: false,
		},
		{
			id: 'monitor',
			action: 'Read the position: bins, conversion, unclaimed LP fees, swap fee percent. No transaction.',
			requiresOwnerConfirmation: false,
			submit: false,
		},
		{
			id: 'close',
			action: 'Build an unsigned close preview. Collect and partial remove stay separate confirmations.',
			requiresOwnerConfirmation: true,
			submit: false,
		},
		{
			id: 'verify',
			action: 'Read the transaction digest: position id, owner, SUI/USDC balances, fees. No resubmit.',
			requiresOwnerConfirmation: false,
			submit: false,
		},
	],
} as const

export function assertMicrotestIsManual(plan: typeof MICROTEST_PLAN = MICROTEST_PLAN): void {
	if (plan.autoExecute) throw new Error('microtest must not auto-execute')
	if (plan.spendsFunds) throw new Error('microtest plan must not spend funds by itself')
	for (const step of plan.steps) {
		if (step.submit) throw new Error(`${step.id} must not submit`)
	}
	const open = plan.steps.find((step) => step.id === 'open')
	const close = plan.steps.find((step) => step.id === 'close')
	if (!open?.requiresOwnerConfirmation || !close?.requiresOwnerConfirmation) {
		throw new Error('open and close each require an OWNER confirmation')
	}
}
