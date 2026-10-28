import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { outputsDir } from '../pipeline'
import { registerTools, safeFetch } from './tools'
import type { Tool } from './tools'

const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const MAX_TRANSCRIPT_CHARS = 100_000
const BINARY = () => process.env.WHISPER_CPP_PATH || ''
const MODEL = () => process.env.WHISPER_MODEL_PATH || ''
class TranscriptionInputError extends Error {}
const isFile = (path: string) => {
  try { return statSync(path).isFile() } catch { return false }
}

export function whisperConfiguration() {
  const missing = [
    !BINARY() && 'WHISPER_CPP_PATH (whisper.cpp whisper-cli executable)',
    !MODEL() && 'WHISPER_MODEL_PATH (local ggml model file)',
    BINARY() && !isFile(BINARY()) && `WHISPER_CPP_PATH is not a readable file: ${BINARY()}`,
    MODEL() && !isFile(MODEL()) && `WHISPER_MODEL_PATH is not a readable file: ${MODEL()}`
  ].filter(Boolean) as string[]
  return { configured: missing.length === 0, missing }
}

function assertWav(buffer: Buffer) {
  if (buffer.length < 44 || buffer.length > MAX_AUDIO_BYTES) throw new TranscriptionInputError('Audio must be a WAV file no larger than 50 MiB')
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new TranscriptionInputError('Only PCM WAV audio is supported by this local Whisper setup')
  const formatOffset = buffer.indexOf(Buffer.from('fmt '))
  if (formatOffset < 0 || formatOffset + 24 > buffer.length) throw new TranscriptionInputError('WAV file has no valid format chunk')
  const audioFormat = buffer.readUInt16LE(formatOffset + 8)
  const bitsPerSample = buffer.readUInt16LE(formatOffset + 22)
  if (audioFormat !== 1 || bitsPerSample !== 16) throw new TranscriptionInputError('Whisper.cpp requires uncompressed 16-bit PCM WAV audio')
}

function execute(binary: string, model: string, input: string, outputPrefix: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['-m', model, '-f', input, '-otxt', '-of', outputPrefix, '-nt'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    let timedOut = false
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000) })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 15 * 60_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Could not start whisper.cpp: ${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error('Local Whisper transcription timed out after 15 minutes'))
      if (code !== 0) return reject(new Error(`whisper.cpp exited with code ${code}${stderr ? `: ${stderr}` : ''}`))
      resolve()
    })
  })
}

export async function transcribeWav(buffer: Buffer) {
  assertWav(buffer)
  const config = whisperConfiguration()
  if (!config.configured) throw new Error(`Local Whisper is not configured: ${config.missing.join(', ')}`)
  const workDir = mkdtempSync(join(tmpdir(), 'nodular-whisper-'))
  const input = join(workDir, 'input.wav')
  const outputPrefix = join(workDir, 'transcript')
  try {
    writeFileSync(input, buffer, { flag: 'wx' })
    await execute(BINARY(), MODEL(), input, outputPrefix)
    const transcriptPath = `${outputPrefix}.txt`
    if (!existsSync(transcriptPath)) throw new Error('whisper.cpp completed without producing its transcript file')
    const text = readFileSync(transcriptPath, 'utf8').trim()
    if (text.length > MAX_TRANSCRIPT_CHARS) throw new Error('Transcript exceeded the 100,000 character output limit')
    return { text, engine: 'whisper.cpp', mode: 'local-offline', characters: text.length }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

async function readAudioUrl(audioUrl: string) {
  const local = audioUrl.match(/^\/outputs\/([\w.-]+\.wav)$/)
  let buffer: Buffer
  if (local) {
    const path = join(outputsDir, local[1])
    if (!existsSync(path)) throw new Error('Audio file not found')
    buffer = readFileSync(path)
  } else {
    const url = new URL(audioUrl)
    if (url.protocol !== 'https:') throw new Error('audioUrl must use HTTPS or refer to a local /outputs/*.wav file')
    const response = await safeFetch(url.toString())
    if (!response.ok) throw new Error(`Audio fetch failed: HTTP ${response.status}`)
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'].includes(type)) throw new Error('audioUrl must return a WAV content type')
    const length = Number(response.headers.get('content-length') || 0)
    if (length > MAX_AUDIO_BYTES) throw new Error('Audio URL exceeds the 50 MiB limit')
    const chunks: Buffer[] = []
    let total = 0
    if (!response.body) throw new Error('Audio response was empty')
    const reader = response.body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const part = Buffer.from(value)
        total += part.length
        if (total > MAX_AUDIO_BYTES) {
          await reader.cancel()
          throw new Error('Audio URL exceeds the 50 MiB limit')
        }
        chunks.push(part)
      }
    } finally {
      reader.releaseLock()
    }
    buffer = Buffer.concat(chunks, total)
  }
  return buffer
}

const whisperTool: Tool = {
  name: 'whisper_transcribe_audio',
  risk: 'safe',
  description: 'Transcribe a PCM WAV file locally with whisper.cpp. Audio is not sent to an external provider. Requires WHISPER_CPP_PATH and WHISPER_MODEL_PATH on the server; accepts a local /outputs/*.wav file or public HTTPS WAV URL up to 50 MiB.',
  parameters: { type: 'object', properties: { audioUrl: { type: 'string', minLength: 1, maxLength: 2048 } }, required: ['audioUrl'] },
  async run(args) {
    const audioUrl = String(args.audioUrl || '').trim()
    if (!audioUrl || audioUrl.length > 2048) throw new Error('audioUrl must contain 1-2048 characters')
    return transcribeWav(await readAudioUrl(audioUrl))
  }
}

export function registerTranscriptionTools() {
  registerTools([whisperTool])
}

export function whisperIntegrationStatus() {
  const config = whisperConfiguration()
  return {
    name: 'whisper',
    configured: config.configured,
    missing: config.missing,
    connected: config.configured,
    capabilities: ['Offline PCM WAV transcription on the Nodular server', 'Maximum WAV size 50 MiB; transcript limit 100,000 characters']
  }
}

export function registerTranscriptionRoutes(app: FastifyInstance) {
  app.get('/api/integrations/whisper', async () => whisperIntegrationStatus())
  app.post('/api/integrations/whisper/transcribe', async (req, reply) => {
    const config = whisperConfiguration()
    if (!config.configured) return reply.status(503).send({ error: `Local Whisper is not configured: ${config.missing.join(', ')}` })
    try {
      if (!req.isMultipart()) return reply.status(400).send({ error: 'Upload a WAV file using multipart/form-data' })
      const file = await req.file()
      if (!file) return reply.status(400).send({ error: 'Select a WAV file to transcribe' })
      if (!/\.(wav)$/i.test(file.filename) || !['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'].includes(file.mimetype.toLowerCase())) {
        return reply.status(400).send({ error: 'Upload a PCM WAV file; other audio formats are not supported by this local setup' })
      }
      const buffer = await file.toBuffer()
      const result = await transcribeWav(buffer)
      return { filename: file.filename.slice(0, 120), ...result }
    } catch (error) {
      const status = error instanceof TranscriptionInputError ? 400 : 500
      return reply.status(status).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
}
