
// Supabase client - frontend
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = url && anon ? createClient(url, anon) : null

export async function saveWorkflow(id: string, nodes: any[], edges: any[], userId?: string) {
  if (!supabase) {
    console.log('[Supabase] No config - saving locally')
    localStorage.setItem(`wf-${id}`, JSON.stringify({ nodes, edges }))
    return { id, local: true }
  }
  const { data, error } = await supabase.from('workflows').upsert({
    id,
    name: id,
    nodes,
    edges,
    user_id: userId,
    updated_at: new Date().toISOString()
  }).select().single()
  if (error) throw error
  return data
}

export async function loadWorkflows(userId?: string) {
  if (!supabase) {
    const local = Object.keys(localStorage).filter(k => k.startsWith('wf-')).map(k => {
      const { nodes, edges } = JSON.parse(localStorage.getItem(k)!)
      return { id: k.replace('wf-',''), nodes, edges, local: true }
    })
    return local
  }
  const { data } = await supabase.from('workflows').select('*').eq('user_id', userId || '').order('updated_at', { ascending: false })
  return data || []
}
