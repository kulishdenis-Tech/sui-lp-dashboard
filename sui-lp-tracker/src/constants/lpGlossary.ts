/**
 * Short English lines for tooltips. Full definitions: `docs/GLOSSARY.md`.
 * Data: `currentValueUSD` = Liquidity · `positionValueUsd()` = Value.
 */
export const LP_GLOSSARY = {
	liquidity:
		'USD Value of pool position tokens at current spot price (excludes unclaimed fees and rewards).',
	value: 'Liquidity plus unclaimed fees and rewards at current spot price.',
	valueColumn: 'Liquidity plus unclaimed fees and rewards at current spot price.',
	valueClosed: 'Realized exit: withdrawn liquidity plus claimed fees and rewards.',
} as const
