// Policy checks for app-owner tool auto-approval. Env is read on each call.
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

delete process.env.OWNER_USER_IDS
delete process.env.OWNER_USER_ID
delete process.env.MCP_ADMIN_USER

const { autoApproveOwnerTools, isAppOwner, ownerUserIds } = await import('../server/agent/owner.ts')

ok(!isAppOwner(null) && !isAppOwner('') && !isAppOwner('local') && !isAppOwner('user_someone_else'), 'blank env: nobody is an owner, including open-mode local')
ok(!autoApproveOwnerTools('local') && !autoApproveOwnerTools('user_other') && !autoApproveOwnerTools(null, { asOwner: true }), 'blank env does not auto-approve')
ok(autoApproveOwnerTools('local', { asOwner: true }) && !autoApproveOwnerTools('local', { asOwner: true, unattended: true }), 'MCP admin token trusts that run only; unattended still gated')

process.env.OWNER_USER_IDS = 'user_owner_test, user_second'
ok(isAppOwner('user_owner_test') && isAppOwner('user_second') && !isAppOwner('local') && !isAppOwner('user_other'), 'OWNER_USER_IDS matches listed ids only')
ok(autoApproveOwnerTools('user_owner_test') && !autoApproveOwnerTools('user_other'), 'listed owner auto-approved; other user gated')
ok(!autoApproveOwnerTools('user_owner_test', { unattended: true }), 'owner automation does not auto-approve')

delete process.env.OWNER_USER_IDS
process.env.OWNER_USER_ID = 'user_single'
ok(isAppOwner('user_single') && !isAppOwner('local'), 'OWNER_USER_ID is a single-id alias')

delete process.env.OWNER_USER_ID
process.env.MCP_ADMIN_USER = 'user_admin_env'
ok(isAppOwner('user_admin_env') && !isAppOwner('local'), 'explicit MCP_ADMIN_USER is an owner; implicit local is not')

process.env.OWNER_USER_IDS = '  user_a\nuser_b,user_c  '
process.env.OWNER_USER_ID = 'user_b'
process.env.MCP_ADMIN_USER = 'user_d'
ok(ownerUserIds().slice().sort().join() === 'user_a,user_b,user_c,user_d', 'ids merge and trim: ' + ownerUserIds().join())
ok(!autoApproveOwnerTools('user_not_listed', { asOwner: false }), 'non-owner flag cannot self-approve')

process.exit(process.exitCode || 0)
