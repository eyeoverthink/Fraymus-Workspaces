import sharp from 'sharp'
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
const lab = await fetch(`${base}/api/idea-finder/lab`).then((r) => r.json())
check(lab.settings.revenueGoal === 1000000 && lab.topics.includes('AI careers'), 'creative lab exposes default stretch goal and public trend topics')
const settings = await fetch(`${base}/api/idea-finder/settings`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...lab.settings, mission: 'Test affordable repair-shop AI workflows', revenueGoal: 100000000, actualRevenue: 25 })
}).then((r) => r.json())
check(settings.revenueGoal === 100000000 && settings.actualRevenue === 25, 'moonshot goals are stored separately from self-reported actual revenue')
const combinedResponse = await fetch(`${base}/api/idea-finder`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ audience: 'repair shops', query: 'Combine scheduling with AI skills', notes: 'Customers lose appointments to manual followups', imageDescription: 'Whiteboard showing missed appointments', duns: '123456789', count: 10 })
})
const combined = await combinedResponse.json()
check(combinedResponse.ok && combined.ideas?.length === 10 && combined.sources?.length === 3 && combined.generation.mode === 'local-combinator', 'HTTP idea lab combines text, image descriptions and D-U-N-S context into ten saved hypotheses')
const reviewResponse = await fetch(`${base}/api/idea-finder/${combined.id}/reviews/0`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'testing', creativity: 9, usefulness: 8, notes: 'Pilot interview planned' })
})
check(reviewResponse.ok && (await fetch(`${base}/api/idea-finder/lab`).then((r) => r.json())).reviews.some((review) => review.reportId === combined.id && review.creativity === 9), 'HTTP human creativity review persists')
const invalidReview = await fetch(`${base}/api/idea-finder/${combined.id}/reviews/0`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'validated', creativity: 9, usefulness: 8, notes: '' })
})
check(invalidReview.status === 400, 'HTTP rejects validated status without written evidence')
const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer()
const imageBody = new FormData()
imageBody.append('analyze', 'true')
imageBody.append('image', new Blob([image], { type: 'image/png' }), 'evidence.png')
const imageResponse = await fetch(`${base}/api/idea-finder/image`, { method: 'POST', body: imageBody })
const imageResult = await imageResponse.json()
check(imageResponse.ok && imageResult.status === 'description_required' && imageResult.metadata.width === 10, 'HTTP image upload decodes locally and honestly requests a description without a vision model')
const noConsent = new FormData()
noConsent.append('image', new Blob([image], { type: 'image/png' }), 'evidence.png')
check((await fetch(`${base}/api/idea-finder/image`, { method: 'POST', body: noConsent })).status === 400, 'image model analysis cannot run without affirmative consent')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
process.exitCode = failures ? 1 : 0
