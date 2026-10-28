export function browserUrl(value: string, appOrigin: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS address without embedded credentials.')
  if (url.origin === appOrigin) throw new Error('Open external sites here, not another copy of this app.')
  return url.toString()
}

export async function captureScreenshot(signal: AbortSignal): Promise<File> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) throw new Error('Tab/window capture is unavailable here. Open the app in a supported desktop browser on localhost or HTTPS, or upload a screenshot in Idea Finder.')
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  const stop = () => stream.getTracks().forEach((track) => track.stop())
  if (signal.aborted) { stop(); throw new Error('Capture cancelled.') }
  signal.addEventListener('abort', stop, { once: true })
  const video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); video.onloadeddata = null; video.onerror = null; signal.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); reject(new Error('Capture cancelled.')) }
      const timer = setTimeout(() => { cleanup(); reject(new Error('No screen frame arrived. Try choosing a tab or window again.')) }, 15000)
      video.onloadeddata = () => { cleanup(); resolve() }
      video.onerror = () => { cleanup(); reject(new Error('The selected screen could not be read.')) }
      signal.addEventListener('abort', abort, { once: true })
      void video.play().catch((error: unknown) => { cleanup(); reject(error) })
    })
    if (signal.aborted || !video.videoWidth || !video.videoHeight) throw new Error('Capture ended before a frame was available.')
    const scale = Math.min(1, 1920 / video.videoWidth, 1920 / video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot create a screenshot canvas.')
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode the screenshot.')), 'image/jpeg', 0.9))
    return new File([blob], `screen-${Date.now()}.jpg`, { type: 'image/jpeg' })
  } finally {
    stop()
    signal.removeEventListener('abort', stop)
    video.pause()
    video.srcObject = null
  }
}
