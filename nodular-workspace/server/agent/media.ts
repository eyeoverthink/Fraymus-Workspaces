import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { outputsDir } from '../pipeline'
import { registerTools } from './tools'
import type { Tool } from './tools'

const RESOLUTIONS = ['landscape', 'portrait', 'square', 'landscape-4k', 'portrait-4k', 'square-4k']
const FORMATS = ['mp4', 'webm', 'gif']
const QUALITIES = ['draft', 'looks', 'delivery']

function sh(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, shell: process.platform === 'win32', env: { ...process.env, CI: '1' } })
    let out = ''
    const add = (d: Buffer) => { out = (out + d.toString()).slice(-6000) }
    p.stdout.on('data', add); p.stderr.on('data', add)
    const timer = setTimeout(() => { p.kill(); rej(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s\n${out}`)) }, timeoutMs)
    p.on('error', (e) => { clearTimeout(timer); rej(e) })
    p.on('close', (code) => { clearTimeout(timer); res({ code: code ?? 1, out }) })
  })
}

const hyperframesRender: Tool = {
  name: 'hyperframes_render',
  description: 'Render a HyperFrames composition (one full HTML document: root element with data-composition-id/data-start/data-duration/data-width/data-height, clips with class="clip", and a paused GSAP timeline registered on window.__timelines) to a deterministic video using headless Chrome + FFmpeg. Returns mediaUrl.',
  risk: 'approval',
  parameters: {
    type: 'object',
    properties: {
      html: { type: 'string', description: 'Complete index.html for the composition' },
      resolution: { type: 'string', enum: RESOLUTIONS, description: 'Canvas preset; must match the data-width/height in the HTML (default landscape)' },
      format: { type: 'string', enum: FORMATS },
      fps: { type: 'integer', minimum: 1, maximum: 60 },
      quality: { type: 'string', enum: QUALITIES }
    },
    required: ['html']
  },
  async run(a: any) {
    const html = String(a.html || '')
    if (html.length < 50 || html.length > 500_000) throw new Error('html must be a full composition document (50 to 500000 chars)')
    const resolution = RESOLUTIONS.includes(a.resolution) ? a.resolution : 'landscape'
    const format = FORMATS.includes(a.format) ? a.format : 'mp4'
    const quality = QUALITIES.includes(a.quality) ? a.quality : 'looks'
    const fps = Number.isInteger(a.fps) && a.fps >= 1 && a.fps <= 60 ? a.fps : 30
    const id = randomUUID().slice(0, 8)
    const dir = resolve(`${process.env.DATA_DIR || './data'}/hf-${id}`)
    mkdirSync(dir, { recursive: true })
    const outName = `${Date.now()}-${id}.${format}`
    mkdirSync(outputsDir, { recursive: true })
    try {
      const init = await sh('npx', ['-y', 'hyperframes', 'init', 'proj', '--example', 'blank', '--non-interactive', '--skip-skills', '--skip-transcribe', '--resolution', resolution], dir, 180_000)
      if (init.code !== 0) throw new Error(`hyperframes init failed:\n${init.out}`)
      const proj = `${dir}/proj`
      writeFileSync(`${proj}/index.html`, html)
      const outPath = resolve(`${outputsDir}/${outName}`)
      const r = await sh('npx', ['-y', 'hyperframes', 'render', '--output', outPath, '--format', format, '--fps', String(fps), '--quality', quality, '--quiet'], proj, 20 * 60_000)
      if (r.code !== 0 || !existsSync(outPath)) throw new Error(`hyperframes render failed (exit ${r.code}). Run 'npx hyperframes doctor' on the server (needs Chrome and FFmpeg on PATH).\n${r.out}`)
      return { mediaUrl: `/outputs/${outName}`, bytes: statSync(outPath).size, format, fps, resolution }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export const registerMediaTools = () => registerTools([hyperframesRender])
