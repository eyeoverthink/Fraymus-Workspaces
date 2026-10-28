
import { ReactFlow, Background, Controls, useNodesState, useEdgesState, addEdge, MiniMap } from '@xyflow/react'
import { useCallback, useEffect } from 'react'
import { nodeTypes } from '../nodes'
import { useWorkflowStore } from '../store/useWorkflowStore'
import { executeWorkflow } from '../engine/executor'

export default function WorkflowCanvas() {
  const { nodes: initialNodes, edges: initialEdges, setNodes: storeSetNodes, setEdges: storeSetEdges, setIsRunning, setPreviewHtml, addLog, setAgentSuggestion, setCode } = useWorkflowStore()
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => { storeSetNodes(nodes as any) }, [nodes])
  useEffect(() => { storeSetEdges(edges as any) }, [edges])

  // REA realtime suggestion
  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/rea/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes, edges }) })
        .then(r => r.json()).then(d => setAgentSuggestion(d.suggestion)).catch(()=>{})
    }, 800)
    return () => clearTimeout(t)
  }, [nodes, edges])

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), [setEdges])

  // Full run logic - no stubs
  const runWorkflow = useCallback(async () => {
    setIsRunning(true)
    addLog({ type: 'start', time: Date.now(), msg: 'Starting 5-node workflow: Llama → FLUX → Remover → Upscaler → Preview' })
    try {
      const result = await executeWorkflow(nodes as any, edges as any, {
        workflowId: 'ugc-mirror-selfie-v1',
        onProgress: (r) => {
          addLog({ type: 'node', nodeId: r.nodeId, duration: r.durationMs, error: r.error, time: Date.now() })
          // Update node with output for visual feedback
          setNodes((nds) => nds.map((n: any) => n.id === r.nodeId ? { ...n, data: { ...n.data, lastOutput: r.output } } : n))
          if (r.output?.html) setPreviewHtml(r.output.html)
          if (r.output?.imageUrl && r.type.includes('upscaler')) {
            setPreviewHtml(`<div style="padding:12px"><img src="${r.output.imageUrl}" style="max-width:100%;border-radius:12px" /><p style="font-size:12px;color:#666">4K upscaled output - ready to deploy</p></div>`)
          }
        }
      })
      addLog({ type: 'success', result, time: Date.now() })
      if (result.finalOutput?.html) setPreviewHtml(result.finalOutput.html)
      setCode(`// Last run: ${new Date().toISOString()}\n// Status: ${result.status}\n// Duration: ${(result.finishedAt! - result.startedAt)/1000}s\n// Nodes: ${Object.keys(result.results).length}\n\n${JSON.stringify(result, null, 2).slice(0,2000)}`)
    } catch (e: any) {
      addLog({ type: 'error', msg: e.message, time: Date.now() })
    } finally {
      setIsRunning(false)
    }
  }, [nodes, edges])

  // Expose run to window for App header button
  useEffect(() => { (window as any).runWorkflow = runWorkflow }, [runWorkflow])

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a0a', position: 'relative' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes as any} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView>
        <Background color="#222" gap={16} />
        <Controls />
        <MiniMap style={{ background: '#111' }} />
      </ReactFlow>
      <button onClick={runWorkflow} style={{ position: 'absolute', bottom: 20, left: 20, background: '#fff', color: '#000', border: 0, padding: '10px 18px', borderRadius: 20, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>▶ Run Workflow</button>
    </div>
  )
}
