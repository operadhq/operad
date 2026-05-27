/**
 * Cloudflare Container Worker — routes incoming requests to the Operad API container.
 *
 * The container runs the existing Dockerfile (Node.js + Hono on port 3111).
 * This Worker manages container lifecycle: start, sleep, wake, route.
 */
import { Container } from 'cloudflare:workers'

interface Env {
  OPERAD_API: DurableObjectNamespace<OperadAPI>
  DATABASE_URL: string
  API_KEY: string
}

export class OperadAPI extends Container {
  defaultPort = 3111
  sleepAfter = '5m' // Sleep after 5 minutes of inactivity (saves cost)

  override get envVars() {
    return {
      ADAPTER: 'postgres',
      DATABASE_URL: this.env.DATABASE_URL,
      API_KEY: this.env.API_KEY,
      PORT: '3111',
    }
  }

  override onStart() {
    console.log('[operad] Container started')
  }

  override onStop() {
    console.log('[operad] Container stopped')
  }

  override onError(error: unknown) {
    console.error('[operad] Container error:', error)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = env.OPERAD_API.getByName('operad-main')
    return container.fetch(request)
  },
}
