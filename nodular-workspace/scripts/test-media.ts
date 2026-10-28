import { allTools, registerTools } from '../server/agent/tools'
import { registerMediaTools } from '../server/agent/media'

registerMediaTools()
const t = allTools().find((x) => x.name === 'hyperframes_render')!
const html = `<!doctype html><html><head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>html,body{margin:0;background:#111}#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#111;color:#fff;font:700 96px sans-serif}.clip{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="1080" data-height="1920">
<div class="clip" data-start="0" data-duration="2" data-track-index="0"><span id="t">Hello</span></div></div>
<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.from("#t",{opacity:0,y:80,duration:1});window.__timelines["main"]=tl;</script></body></html>`
const r = await t.run({ html, resolution: 'portrait', quality: 'draft', fps: 24 }, {} as any)
console.log(JSON.stringify(r))
