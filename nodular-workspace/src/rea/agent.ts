import { REA_SYSTEM_PROMPT } from './prompts'

export async function getReaSuggestion(nodes: any[], edges: any[], groqKey?: string) {
  // This runs on server - calls Groq free tier
  const prompt = REA_SYSTEM_PROMPT + '\n\nCurrent canvas: ' + JSON.stringify({ nodes: nodes.map(n=>({id:n.id,type:n.type,data:n.data})), edges })

  // Call Groq - free Llama 3.3
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: REA_SYSTEM_PROMPT }, { role: 'user', content: prompt }], stream: false })
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || 'Add a post-processing node for better realism'
}
