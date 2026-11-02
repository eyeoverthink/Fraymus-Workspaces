import { registerTools, type Tool } from './tools'
import { canReadSkill, evaluateQa, lookupAssets, nextStep, readSkill, recordLearning } from './explainer-workflow'

const tools: Tool[] = [
  {
    name: 'explainer_next_step',
    risk: 'safe',
    description: 'Return the next code-explainer-60s step only: which agent or tool to run, and a short instruction. Does not include the skill or the QA thresholds. from is the step just finished. tier is express, standard, or studio. Leaving qa requires qa=pass, fail, or override.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        tier: { type: 'string', enum: ['express', 'standard', 'studio'] },
        hookChosen: { type: 'boolean' },
        qa: { type: 'string', enum: ['pass', 'fail', 'override'] },
        scenesLeft: { type: 'integer', minimum: 0, maximum: 40 },
        rendered: { type: 'boolean' },
        wantRealism: { type: 'boolean' }
      }
    },
    async run(a) {
      return nextStep({
        from: a?.from,
        tier: a?.tier,
        hookChosen: a?.hookChosen,
        qa: a?.qa,
        scenesLeft: a?.scenesLeft,
        rendered: a?.rendered,
        wantRealism: a?.wantRealism
      })
    }
  },
  {
    name: 'explainer_qa',
    risk: 'safe',
    description: 'Compare caller-supplied measurements with the explainer check file. Returns only status pass or fail and a list of fixes. Does not read video files and does not return thresholds. Frame probing is not implemented; missing numbers fail closed.',
    parameters: {
      type: 'object',
      properties: {
        measurements: {
          type: 'object',
          properties: {
            cameraSpeedPxPerSec: { type: 'number' },
            stillFrameMs: { type: 'number' },
            colorStrength: { type: 'number' },
            loudnessLufs: { type: 'number' },
            flicker: { type: 'number' },
            mobileReadability: { type: 'number' }
          }
        }
      }
    },
    async run(a) {
      return evaluateQa(a?.measurements)
    }
  },
  {
    name: 'asset_lookup',
    risk: 'safe',
    description: 'Search the local explainer placeholder catalog. Rows are not files. A miss is not downloaded. The remote asset_library_fetch HTTP tool is a stub and stays unregistered until its env vars are set.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(a) {
      return lookupAssets(a?.query)
    }
  },
  {
    name: 'explainer_learn',
    risk: 'safe',
    description: 'Append an approved explainer video to the local reference pool and store corrections as extra checks. Corrections can tighten shipped thresholds and cannot loosen them. The result does not echo thresholds.',
    parameters: {
      type: 'object',
      properties: {
        videoId: { type: 'string' },
        topic: { type: 'string' },
        tier: { type: 'string', enum: ['express', 'standard', 'studio'] },
        mediaUrl: { type: 'string' },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              metric: { type: 'string' },
              min: { type: 'number' },
              max: { type: 'number' },
              fix: { type: 'string' }
            },
            required: ['metric', 'fix']
          }
        }
      },
      required: ['videoId', 'topic']
    },
    async run(a) {
      return recordLearning({
        videoId: a?.videoId,
        topic: a?.topic,
        tier: a?.tier,
        mediaUrl: a?.mediaUrl,
        corrections: a?.corrections
      })
    }
  },
  {
    name: 'read_explainer_skill',
    risk: 'safe',
    description: 'Read the code-explainer skill. Only explainer_planner may call this. Other agents work from the brief.',
    parameters: { type: 'object', properties: {} },
    async run(_a, ctx) {
      if (!canReadSkill(ctx.agentId)) throw new Error('the explainer skill is readable only by explainer_planner')
      return { skill: readSkill() }
    }
  }
]

export function registerExplainerTools() {
  registerTools(tools)
}
