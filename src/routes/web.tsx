/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import type { Env } from '../types'

const web = new Hono<Env>()

// GET / - Serve HTML shell
web.get('/', (c) => {
  return c.html(
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Mob Chat</title>
        <link rel="stylesheet" href="/static/client.css" />
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="/static/client.js"></script>
      </body>
    </html>
  )
})

export default web
