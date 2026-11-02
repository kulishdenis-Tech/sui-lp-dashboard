import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataFreshnessHint } from '@/pages/overviewLab/DataFreshnessHint'

describe('DataFreshnessHint STALE without cache', () => {
	it('shows STALE and nemа dat when lastSuccessAtMs is missing', () => {
		const html = renderToStaticMarkup(
			<DataFreshnessHint updatedAtMs={null} stale lastSuccessAtMs={null} />,
		)
		expect(html).toContain('STALE')
		expect(html).toContain('нема даних')
	})
})
