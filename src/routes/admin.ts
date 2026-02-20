/**
 * Admin API routes for managing LLM configs and Slack apps
 * These endpoints should be protected by Cloudflare Access in production
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import type { LLMConfig, SlackAppConfig } from '../lib/slack/types'

const admin = new Hono<Env>()

// ============================================================================
// LLM Configs CRUD
// ============================================================================

// GET /admin/llm-configs - List all LLM configs
admin.get('/llm-configs', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT name, provider, base_url, model, created_at, updated_at FROM llm_configs ORDER BY name'
    ).all<Omit<LLMConfig, 'api_key'>>()

    return c.json({ configs: result.results })
  } catch (error) {
    console.error('Failed to list LLM configs:', error)
    return c.json({ error: 'Failed to list LLM configs' }, 500)
  }
})

// GET /admin/llm-configs/:name - Get a single LLM config (excludes api_key for security)
admin.get('/llm-configs/:name', async (c) => {
  try {
    const name = c.req.param('name')
    const result = await c.env.DB.prepare(
      'SELECT name, provider, base_url, model, created_at, updated_at FROM llm_configs WHERE name = ?'
    ).bind(name).first<Omit<LLMConfig, 'api_key'>>()

    if (!result) {
      return c.json({ error: 'Config not found' }, 404)
    }

    return c.json({ config: result })
  } catch (error) {
    console.error('Failed to get LLM config:', error)
    return c.json({ error: 'Failed to get LLM config' }, 500)
  }
})

// POST /admin/llm-configs - Create a new LLM config
admin.post('/llm-configs', async (c) => {
  try {
    const body = await c.req.json<{
      name: string
      provider: string
      base_url: string
      api_key: string
      model: string
    }>()

    if (!body.name || !body.provider || !body.base_url || !body.api_key || !body.model) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    const now = Date.now()
    await c.env.DB.prepare(`
      INSERT INTO llm_configs (name, provider, base_url, api_key, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(body.name, body.provider, body.base_url, body.api_key, body.model, now, now).run()

    return c.json({ success: true, name: body.name })
  } catch (error: any) {
    console.error('Failed to create LLM config:', error)
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Config name already exists' }, 409)
    }
    return c.json({ error: 'Failed to create LLM config' }, 500)
  }
})

// PUT /admin/llm-configs/:name - Update an LLM config
admin.put('/llm-configs/:name', async (c) => {
  try {
    const name = c.req.param('name')
    const body = await c.req.json<{
      provider?: string
      base_url?: string
      api_key?: string
      model?: string
    }>()

    // Build dynamic update query
    const updates: string[] = []
    const values: any[] = []

    if (body.provider) {
      updates.push('provider = ?')
      values.push(body.provider)
    }
    if (body.base_url) {
      updates.push('base_url = ?')
      values.push(body.base_url)
    }
    if (body.api_key) {
      updates.push('api_key = ?')
      values.push(body.api_key)
    }
    if (body.model) {
      updates.push('model = ?')
      values.push(body.model)
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400)
    }

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(name)

    const result = await c.env.DB.prepare(`
      UPDATE llm_configs SET ${updates.join(', ')} WHERE name = ?
    `).bind(...values).run()

    if (result.meta.changes === 0) {
      return c.json({ error: 'Config not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to update LLM config:', error)
    return c.json({ error: 'Failed to update LLM config' }, 500)
  }
})

// DELETE /admin/llm-configs/:name - Delete an LLM config
admin.delete('/llm-configs/:name', async (c) => {
  try {
    const name = c.req.param('name')

    // Check if any Slack apps are using this config
    const apps = await c.env.DB.prepare(
      'SELECT app_name FROM slack_apps WHERE llm_config_name = ?'
    ).bind(name).all<{ app_name: string }>()

    if (apps.results.length > 0) {
      const appNames = apps.results.map(a => a.app_name).join(', ')
      return c.json({
        error: `Cannot delete: config is used by Slack apps: ${appNames}`
      }, 400)
    }

    const result = await c.env.DB.prepare(
      'DELETE FROM llm_configs WHERE name = ?'
    ).bind(name).run()

    if (result.meta.changes === 0) {
      return c.json({ error: 'Config not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to delete LLM config:', error)
    return c.json({ error: 'Failed to delete LLM config' }, 500)
  }
})

// ============================================================================
// Slack Apps CRUD
// ============================================================================

// GET /admin/slack-apps - List all Slack apps
admin.get('/slack-apps', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT id, app_id, team_id, app_name, bot_user_id, llm_config_name,
             created_at, updated_at
      FROM slack_apps ORDER BY app_name
    `).all<Omit<SlackAppConfig, 'bot_token' | 'signing_secret' | 'system_prompt'>>()

    return c.json({ apps: result.results })
  } catch (error) {
    console.error('Failed to list Slack apps:', error)
    return c.json({ error: 'Failed to list Slack apps' }, 500)
  }
})

// GET /admin/slack-apps/:appId - Get a single Slack app (excludes sensitive fields for security)
admin.get('/slack-apps/:appId', async (c) => {
  try {
    const appId = c.req.param('appId')
    const result = await c.env.DB.prepare(
      `SELECT id, app_id, team_id, app_name, bot_user_id, llm_config_name, system_prompt,
              created_at, updated_at
       FROM slack_apps WHERE app_id = ?`
    ).bind(appId).first<Omit<SlackAppConfig, 'bot_token' | 'signing_secret'>>()

    if (!result) {
      return c.json({ error: 'Slack app not found' }, 404)
    }

    return c.json({ app: result })
  } catch (error) {
    console.error('Failed to get Slack app:', error)
    return c.json({ error: 'Failed to get Slack app' }, 500)
  }
})

// POST /admin/slack-apps - Create a new Slack app
admin.post('/slack-apps', async (c) => {
  try {
    const body = await c.req.json<{
      app_id: string
      app_name: string
      bot_token: string
      signing_secret: string
      llm_config_name: string
      team_id?: string
      system_prompt?: string
    }>()

    if (!body.app_id || !body.app_name || !body.bot_token || !body.signing_secret || !body.llm_config_name) {
      return c.json({ error: 'Missing required fields' }, 400)
    }

    // Verify LLM config exists
    const configExists = await c.env.DB.prepare(
      'SELECT name FROM llm_configs WHERE name = ?'
    ).bind(body.llm_config_name).first()

    if (!configExists) {
      return c.json({ error: `LLM config "${body.llm_config_name}" not found` }, 400)
    }

    const now = Date.now()
    await c.env.DB.prepare(`
      INSERT INTO slack_apps (app_id, team_id, app_name, bot_token, signing_secret, llm_config_name, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.app_id,
      body.team_id || null,
      body.app_name,
      body.bot_token,
      body.signing_secret,
      body.llm_config_name,
      body.system_prompt || null,
      now,
      now
    ).run()

    return c.json({ success: true, app_id: body.app_id })
  } catch (error: any) {
    console.error('Failed to create Slack app:', error)
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Slack app ID already exists' }, 409)
    }
    return c.json({ error: 'Failed to create Slack app' }, 500)
  }
})

// PUT /admin/slack-apps/:appId - Update a Slack app
admin.put('/slack-apps/:appId', async (c) => {
  try {
    const appId = c.req.param('appId')
    const body = await c.req.json<{
      app_name?: string
      bot_token?: string
      signing_secret?: string
      llm_config_name?: string
      team_id?: string
      system_prompt?: string
    }>()

    // Build dynamic update query
    const updates: string[] = []
    const values: any[] = []

    if (body.app_name) {
      updates.push('app_name = ?')
      values.push(body.app_name)
    }
    if (body.bot_token) {
      updates.push('bot_token = ?')
      values.push(body.bot_token)
    }
    if (body.signing_secret) {
      updates.push('signing_secret = ?')
      values.push(body.signing_secret)
    }
    if (body.llm_config_name) {
      // Verify LLM config exists
      const configExists = await c.env.DB.prepare(
        'SELECT name FROM llm_configs WHERE name = ?'
      ).bind(body.llm_config_name).first()

      if (!configExists) {
        return c.json({ error: `LLM config "${body.llm_config_name}" not found` }, 400)
      }

      updates.push('llm_config_name = ?')
      values.push(body.llm_config_name)
    }
    if (body.team_id !== undefined) {
      updates.push('team_id = ?')
      values.push(body.team_id || null)
    }
    if (body.system_prompt !== undefined) {
      updates.push('system_prompt = ?')
      values.push(body.system_prompt || null)
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400)
    }

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(appId)

    const result = await c.env.DB.prepare(`
      UPDATE slack_apps SET ${updates.join(', ')} WHERE app_id = ?
    `).bind(...values).run()

    if (result.meta.changes === 0) {
      return c.json({ error: 'Slack app not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to update Slack app:', error)
    return c.json({ error: 'Failed to update Slack app' }, 500)
  }
})

// DELETE /admin/slack-apps/:appId - Delete a Slack app
admin.delete('/slack-apps/:appId', async (c) => {
  try {
    const appId = c.req.param('appId')

    // Delete associated thread mappings first
    await c.env.DB.prepare(
      'DELETE FROM slack_thread_mapping WHERE app_id = ?'
    ).bind(appId).run()

    const result = await c.env.DB.prepare(
      'DELETE FROM slack_apps WHERE app_id = ?'
    ).bind(appId).run()

    if (result.meta.changes === 0) {
      return c.json({ error: 'Slack app not found' }, 404)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to delete Slack app:', error)
    return c.json({ error: 'Failed to delete Slack app' }, 500)
  }
})

export default admin
