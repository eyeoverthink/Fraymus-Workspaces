const base = process.env.BASE_URL || 'http://localhost:3001'
let failures = 0
const check = (condition, label) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++ }

const invalid = await fetch(`${base}/api/idea-finder`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ audience: '', pain: 'Some pain' })
})
check(invalid.status === 400, 'idea finder validates a real target audience')

const response = await fetch(`${base}/api/idea-finder`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ audience: 'independent creators', pain: 'Too many interruptions' })
})
const report = await response.json()
check(response.status === 200 && report.id && report.ideas?.length === 3, 'three evidence-based business hypotheses are generated and saved')
check(report.evidence.focus.pain === 'Too many interruptions' && report.evidence.focus.matchingBlocks >= 1, 'report ties the idea focus to the user-entered time audit')
check(report.ideas.every((idea) => idea.twelveHourMvp && idea.validation && idea.risks.length), 'each idea includes a 12-hour MVP, validation step, and risks')
check(/not a forecast/i.test(report.pricingMath.caveat) && report.caveats.length >= 3, 'revenue arithmetic is explicitly labeled as non-forecast')
check(report.research.status === 'not_requested', 'public search is opt-in and off by default')

const history = await fetch(`${base}/api/idea-finder`).then((r) => r.json())
check(history.reports?.some((item) => item.id === report.id), 'generated report is available in saved history')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
process.exitCode = failures ? 1 : 0
