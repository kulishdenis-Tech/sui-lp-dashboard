import fs from 'node:fs'

const p = new URL('../src/pages/autopilot/autopilot.css', import.meta.url)
let raw = fs.readFileSync(p, 'utf8')
raw = raw.replace(/^\*\s*\{[^}]*\}\s*/m, '')
raw = raw.replace(/^body\s*\{[^}]*\}\s*/m, '')
raw = raw.replace(/^html\[data-theme="light"\]\s*body\s*\{[^}]*\}\s*/m, '')
raw = raw.replace(':root {', '.autopilot-root {')
raw = raw.replace('html[data-theme="light"] {', '.autopilot-root[data-theme="light"] {')
raw = raw.replace(/^button \{/m, '.autopilot-root button {')
raw = raw.replace(/^button:hover \{/m, '.autopilot-root button:hover {')
raw = raw.replace(/^button:disabled \{/m, '.autopilot-root button:disabled {')
raw = raw.replace(/^button\.active \{/m, '.autopilot-root button.active {')
raw = raw.replace(/^button\.active\.buy \{/m, '.autopilot-root button.active.buy {')
raw = raw.replace(/^button\.active\.sell \{/m, '.autopilot-root button.active.sell {')
raw = raw.replace(/^button\.linkish \{/m, '.autopilot-root button.linkish {')
raw = raw.replace(/^input, select \{/m, '.autopilot-root input, .autopilot-root select {')
raw = raw.replace(
	/^input:focus, select:focus, button:focus-visible \{/m,
	'.autopilot-root input:focus, .autopilot-root select:focus, .autopilot-root button:focus-visible {',
)
fs.writeFileSync(p, raw, 'utf8')
console.log('scoped', raw.length)
