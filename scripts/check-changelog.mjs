/**
 * Reject a commit that changes the app version without a matching CHANGELOG section.
 * Does not write the changelog. Root and tracker versions must move together.
 */
import { execFileSync } from 'node:child_process'

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function show(spec) {
	try {
		return execFileSync('git', ['show', spec], { encoding: 'utf8' })
	} catch {
		return null
	}
}

function versionOf(jsonText) {
	const match = jsonText.match(/"version"\s*:\s*"([^"]+)"/)
	return match?.[1] ?? null
}

const rootStaged = show(':package.json')
const trackerStaged = show(':sui-lp-tracker/package.json')
if (rootStaged == null || trackerStaged == null) {
	console.error('check-changelog: package.json is not in the index')
	process.exit(1)
}

const rootVersion = versionOf(rootStaged)
const trackerVersion = versionOf(trackerStaged)
if (!rootVersion || !trackerVersion) {
	console.error('check-changelog: could not read version')
	process.exit(1)
}
if (rootVersion !== trackerVersion) {
	console.error(
		`check-changelog: root version ${rootVersion} and tracker version ${trackerVersion} differ`,
	)
	process.exit(1)
}

const headRoot = versionOf(show('HEAD:package.json') ?? '')
const headTracker = versionOf(show('HEAD:sui-lp-tracker/package.json') ?? '')
const versionChanged = rootVersion !== headRoot || trackerVersion !== headTracker
if (!versionChanged) {
	process.exit(0)
}

const stagedNames = git(['diff', '--cached', '--name-only']).split(/\r?\n/)
if (!stagedNames.includes('CHANGELOG.md')) {
	console.error(`check-changelog: version ${rootVersion} needs a staged CHANGELOG.md section`)
	process.exit(1)
}

const changelog = show(':CHANGELOG.md') ?? ''
const heading = `## ${rootVersion}`
if (!changelog.includes(heading)) {
	console.error(`check-changelog: CHANGELOG.md has no "${heading}" section`)
	process.exit(1)
}
