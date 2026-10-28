
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

export const supabaseAdmin = url && serviceKey ? createClient(url, serviceKey) : null

export async function saveRun(workflowId: string, userId: string | null, results: any, inputPrompt?: string) {
  if (!supabaseAdmin) {
    console.log('[Supabase] No config - skipping run save')
    return { id: 'local', local: true }
  }
  const { data, error } = await supabaseAdmin.from('workflow_runs').insert({
    workflow_id: workflowId,
    user_id: userId,
    status: Object.values(results).some((r: any) => r.error) ? 'failed' : 'success',
    input_prompt: inputPrompt,
    results,
    duration_ms: 0
  }).select().single()
  if (error) console.error('Save run error', error)
  return data
}

export async function uploadImage(buffer: Buffer, path: string) {
  if (!supabaseAdmin) return null
  const { data, error } = await supabaseAdmin.storage.from('workflow-outputs').upload(path, buffer, { contentType: 'image/png', upsert: true })
  if (error) {
    console.error('Upload error', error)
    return null
  }
  const { data: urlData } = supabaseAdmin.storage.from('workflow-outputs').getPublicUrl(path)
  return urlData.publicUrl
}
