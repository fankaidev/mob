# Mob Chat

AI chat application with Cloudflare Workers, Hono, and Claude.

## Architecture

- **Frontend**: `hono/jsx/dom` (React-like, 2.8KB gzipped)
- **Backend**: Hono + Durable Objects + D1
- **Build**: Vite

## Quick Start

```bash
# Install dependencies
npm install

# Setup D1 database
npm run setup:d1

# Build and start dev server
npm run dev
```

Visit http://localhost:8787

Click **⚙️ Settings** to configure your API key.

## Deploy

```bash
npm run deploy
```

## Project Structure

```
src/
├── client/              # Frontend (hono/jsx/dom)
│   ├── App.tsx         # Main component
│   ├── components/     # UI components
│   └── index.tsx       # Entry point
├── routes/             # Backend routes
│   ├── api.ts          # API endpoints
│   └── web.tsx         # HTML shell
├── durable-objects/    # DO implementations
└── index.ts            # Worker entry
```

## Features

- Client-side rendering with hooks (useState, useEffect)
- Persistent chat with D1 + Durable Objects
- Streaming responses
- Settings UI for API configuration

## License

MIT
