
import { FluxNode } from './FluxNode'
import { LlamaNode } from './LlamaNode'
import { HtmlPreviewNode } from './HtmlPreviewNode'
import { BackgroundRemoverNode } from './BackgroundRemoverNode'
import { UpscalerNode } from './UpscalerNode'

export const nodeTypes = { 
  flux: FluxNode, 
  'flux-schnell': FluxNode,
  llama: LlamaNode, 
  'llama-groq': LlamaNode,
  htmlPreview: HtmlPreviewNode, 
  'html-preview': HtmlPreviewNode,
  remover: BackgroundRemoverNode,
  'remover-birefnet': BackgroundRemoverNode,
  upscaler: UpscalerNode,
  'upscaler-realesrgan': UpscalerNode,
}
