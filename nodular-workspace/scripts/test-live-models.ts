import { testConfiguredModels } from '../server/agent/models'
const result = await testConfiguredModels()
for (const item of result.results) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.capability}: ${item.model || item.error}`)
process.exitCode = result.ok ? 0 : 1
