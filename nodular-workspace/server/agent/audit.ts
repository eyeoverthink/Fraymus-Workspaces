import { db, now } from './db'

export type ActionStatus = 'succeeded' | 'failed' | 'approval_requested' | 'approved' | 'rejected'

export function recordAction(userId: string, agentId: string, action: string, status: ActionStatus, runId?: string | null, threadId?: string | null) {
  db.prepare('insert into agent_action_log(user_id,agent_id,run_id,thread_id,action,status,created_at) values(?,?,?,?,?,?,?)')
    .run(userId, agentId, runId || null, threadId || null, action.slice(0, 120), status, now())
}

export function listActionLog(userId: string, agentId?: string, limit = 100) {
  const count = Math.max(1, Math.min(200, Math.trunc(limit) || 100))
  if (agentId) {
    return db.prepare('select id,agent_id,run_id,thread_id,action,status,created_at from agent_action_log where user_id=? and agent_id=? order by id desc limit ?')
      .all(userId, agentId, count)
  }
  return db.prepare('select id,agent_id,run_id,thread_id,action,status,created_at from agent_action_log where user_id=? order by id desc limit ?')
    .all(userId, count)
}
