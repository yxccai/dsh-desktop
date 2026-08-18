const MAX_EVENTS = 200
const MAX_BODY = 500

function text(value, fallback = '') {
  const result = String(value ?? fallback).trim()
  return result.slice(0, MAX_BODY)
}

function eventBody(value) {
  if (value === undefined || value === null) return ''
  return text(value)
}

export function createDesktopEventQueue() {
  const events = []
  let nextSeq = 1
  const push = (kind, title, body) => {
    events.push({ seq: nextSeq++, kind, title, body: eventBody(body), at: new Date().toISOString() })
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }
  return {
    push,
    since(seq) { return events.filter((item) => item.seq > seq).map((item) => ({ ...item })) },
    snapshot() { return events.map((item) => ({ ...item })) },
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function approvalBody(req) {
  return text(req?.description || req?.toolName || req?.tool || req?.name || '有操作需要确认')
}

function agentTitle(agent) {
  return text(agent?.title || agent?.name || agent?.sessionTitle || '')
}

export function apply(ctx) {
  const webServer = ctx.get('webServer') || ctx.webServer
  if (!webServer) return
  const queue = createDesktopEventQueue()
  ctx.on('approval/request', (req, next) => {
    queue.push('approval', '需要你的审批', approvalBody(req))
    return typeof next === 'function' ? next() : undefined
  })
  ctx.on('agent/status', (payload) => {
    if (payload?.status !== 'idle') return
    const title = agentTitle(payload.agent)
    queue.push('done', '任务完成', title ? `${title} 已完成` : 'Agent 任务已完成')
  })
  ctx.on('agent/error', (payload) => {
    const agent = agentTitle(payload?.agent)
    const error = eventBody(payload?.error)
    queue.push('error', 'Agent 报错终止', `${agent ? `${agent}: ` : ''}${error}`.slice(0, MAX_BODY))
  })
  webServer.register({
    kind: 'exact',
    path: '/api/dsh-desktop-events',
    handler: async (req, res) => {
      try {
        if (String(req.method || 'GET').toUpperCase() !== 'GET') return sendJson(res, 400, { error: 'GET required' })
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const rawSince = url.searchParams.get('since') || '0'
        if (!/^\d+$/.test(rawSince)) return sendJson(res, 400, { error: 'since must be an integer' })
        return sendJson(res, 200, { events: queue.since(Number(rawSince)) })
      } catch (error) {
        return sendJson(res, 500, { error: String(error?.message || error) })
      }
    },
  })
}

export { MAX_EVENTS }
