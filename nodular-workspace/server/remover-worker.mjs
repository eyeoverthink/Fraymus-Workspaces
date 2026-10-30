// Runs @imgly/background-removal-node in its own process. It must be imported before sharp:
// loading sharp first makes onnxruntime abort natively ("munmap_chunk(): invalid pointer"), which
// would take the whole API server down. stdin: image bytes, stdout: PNG with alpha.
const { removeBackground } = await import('@imgly/background-removal-node')
const chunks = []
for await (const c of process.stdin) chunks.push(c)
const input = Buffer.concat(chunks)
const sharp = (await import('sharp')).default
const src = await sharp(input).png().toBuffer()
const blob = await removeBackground(new Blob([new Uint8Array(src)], { type: 'image/png' }))
process.stdout.write(Buffer.from(await blob.arrayBuffer()))
