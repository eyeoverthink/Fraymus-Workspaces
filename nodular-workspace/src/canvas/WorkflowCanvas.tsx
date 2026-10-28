import { ReactFlow, Background, Controls, useNodesState, useEdgesState, addEdge, MiniMap } from '@xyflow/react'
import { useCallback, useEffect } from 'react'
import { nodeTypes } from '../nodes'
import { useWorkflowStore } from '../store/useWorkflowStore'
import { executeWorkflow } from '../engine/executor'
import { apiFetch } from '../lib/api'
import { toast } from '../components/Toasts'

const PALETTE: { type: string; label: string; data: any }[] = [
  { type: 'llama-groq', label: 'Llama', data: { prompt: 'mirror selfie, vintage denim' } },
  { type: 'flux-schnell', label: 'FLUX', data: { model: 'black-forest-labs/FLUX.1-schnell', prompt: 'mirror selfie' } },
  { type: 'remover-birefnet', label: 'Remover', data: {} },
  { type: 'upscaler-realesrgan', label: 'Upscaler', data: { scale: 4 } },
  { type: 'html-preview', label: 'Preview', data: {} },
]

export default function WorkflowCanvas() {
  const { nodes: initialNodes, edges: initialEdges, setNodes: storeSetNodes, setEdges: storeSetEdges, isRunning, setIsRunning, setPreviewHtml, addLog, setAgentSuggestion, setCode } = useWorkflowStore()
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => { storeSetNodes(nodes as any) }, [nodes])
  useEffect(() => { storeSetEdges(edges as any) }, [edges])

  // REA realtime suggestion
  useEffect(() => {
    const t = setTimeout(() => {
      const slim = nodes.map((n: any) => ({ id: n.id, type: n.type }))
      apiFetch('/api/rea/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: slim, edges }) })
        .then((r) => r.json()).then((d) => d.suggestion && setAgentSuggestion(d.suggestion)).catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [nodes.length, edges.length])

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges])

  const addNode = (p: (typeof PALETTE)[number]) => {
    const id = String(Date.now())
    setNodes((nds) => [...nds, { id, type: p.type, position: { x: 80 + nds.length * 40, y: 280 + (nds.length % 3) * 40 }, data: { ...p.data } } as any])
  }

  const setNodeData = (nodeId: string, patch: any) =>
    setNodes((nds) => nds.map((n: any) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)))

  const runWorkflow = useCallback(async () => {
    if (useWorkflowStore.getState().isRunning) return
    setIsRunning(true)
    setNodes((nds) => nds.map((n: any) => ({ ...n, data: { ...n.data, lastOutput: undefined } })))
    addLog({ type: 'start', time: Date.now(), msg: `Starting ${nodes.length}-node workflow` })
    try {
      const result = await executeWorkflow(nodes as any, edges as any, {
        workflowId: 'ugc-mirror-selfie-v1',
        onStart: (id) => setNodeData(id, { running: true }),
        onProgress: (r) => {
          addLog({ type: r.error ? 'error' : 'node', nodeId: r.nodeId, duration: r.durationMs, error: r.error, time: Date.now() })
          setNodeData(r.nodeId, { running: false, lastOutput: r.output })
          if (r.error) toast('error', `${r.type}: ${r.error}`)
          if (r.output?.html) setPreviewHtml(r.output.html)
        }
      })
      addLog({ type: result.status === 'success' ? 'success' : 'error', result, time: Date.now() })
      if (result.finalOutput?.html) setPreviewHtml(result.finalOutput.html)
      setCode(`// Last run: ${new Date().toISOString()}\n// Status: ${result.status}\n// Duration: ${(result.finishedAt! - result.startedAt) / 1000}s\n// Nodes: ${Object.keys(result.results).length}\n\n${JSON.stringify(result, (k, v) => (k === 'blob' ? undefined : v), 2).slice(0, 2000)}`)
      if (result.status === 'success') toast('success', 'Workflow finished')
    } catch (e: any) {
      addLog({ type: 'error', msg: e.message, time: Date.now() })
      toast('error', e.message)
    } finally {
      setNodes((nds) => nds.map((n: any) => ({ ...n, data: { ...n.data, running: false } })))
      setIsRunning(false)
    }
  }, [nodes, edges])

  useEffect(() => { (window as any).runWorkflow = runWorkflow }, [runWorkflow])

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a0a', position: 'relative' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes as any} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView>
        <Background color="#222" gap={16} />
        <Controls />
        <MiniMap style={{ background: '#111' }} />
      </ReactFlow>
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 6, zIndex: 5 }}>
        {PALETTE.map((p) => (
          <button key={p.type} onClick={() => addNode(p)} style={{ fontSize: 10, background: '#1a1a1a', color: '#ddd', border: '1px solid #333', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}>+ {p.label}</button>
        ))}
      </div>
      <button onClick={runWorkflow} disabled={isRunning} style={{ position: 'absolute', bottom: 20, left: 20, background: isRunning ? '#555' : '#fff', color: '#000', border: 0, padding: '10px 18px', borderRadius: 20, fontWeight: 700, cursor: isRunning ? 'wait' : 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
        {isRunning ? 'Running...' : '▶ Run Workflow'}
      </button>
    </div>
  )
}
