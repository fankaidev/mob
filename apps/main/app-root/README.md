# Paraflow Tech Stack

A full-stack TypeScript monorepo on **Cloudflare Workers** (serverless), based on Hono + Drizzle + React + Jotai.

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Backend** | [Hono](https://hono.dev) | Web framework |
| | [Drizzle ORM](https://orm.drizzle.team) | Type-safe SQL ORM |
| | [PostgreSQL](https://www.postgresql.org) | Database |
| | [Cloudflare Workers](https://workers.cloudflare.com) | Serverless deployment |
| **Frontend** | [React 19](https://react.dev) | UI framework |
| | [Vite](https://vitejs.dev) | Build tool |
| | [Tailwind CSS](https://tailwindcss.com) | Styling |
| | [Jotai](https://jotai.org) | State management |
| | [jotai-tanstack-query](https://jotai.org/docs/extensions/query) | Server state |
| | [React Router](https://reactrouter.com) | Routing |
| **Testing** | [Vitest](https://vitest.dev) | BDD testing |
| | [PGLite](https://pglite.dev) | In-memory database (for testing) |

## Project Structure

```
app-root/
├── backend/
│   ├── drizzle/                        # SQL migration files
│   └── src/
│       ├── schema.ts                   # Drizzle Schema (data models)
│       ├── app.ts                      # Route registration
│       ├── api/stores/                 # Store API (1:1 mapping with frontend Store)
│       └── infra/gateway/              # External service gateways
│
├── frontend/
│   └── src/
│       ├── stores/                     # Jotai Stores
│       ├── pages/                      # Page components
│       ├── components/                 # Shared components
│       ├── pageLinks.ts                # Centralized route paths
│       └── routes.ts                   # Route configuration
│
└── bdd-test/
    ├── src/
    │   ├── helper.ts                   # Test helper functions
    │   ├── authHelper.ts               # Auth test helpers
    │   └── setupTeardown.ts             # Test setup (PGLite, fetch stub, beforeEach/afterEach)
    └── tests/store/                    # BDD test cases
```

## Core Pattern: Store-API 1:1 (BFF)

Each frontend Store corresponds to a backend API file, using Hono RPC for end-to-end type safety.

| Frontend Store | Backend API | API Route |
|----------------|-------------|-----------|
| `stores/EditPollFormStore.ts` | `api/stores/EditPollFormStore.ts` | `/api/EditPollFormStore` |

---

## Two Loader Patterns

The codebase has **two distinct loader patterns** based on page type:

### Pattern 1: List/Read-Only Pages (e.g., PollListStore)

For pages that only display data without local editing state:

```typescript
export function loader(store: Store) {
  store.set(filterKeywordAtom, '')  // Reset UI state
  store.get(refreshAtom)  // Subscribe to query (non-blocking)
  return null
}
```

### Pattern 2: Edit/Form Pages (e.g., EditPollFormStore)

For pages with forms that need to initialize local state from server data:

```typescript
export function loader(store: Store, params: { id?: string }) {
  const pollId = params.id!
  // Fetch AND initialize form state (non-blocking)
  store.set(fetchAndInitFormAtom, pollId)
  return null
}

// fetchAndInitFormAtom does both:
// 1. Sets the parameter atom
// 2. Resets form to default state
// 3. Triggers refetch
// 4. Copies server data to form state when data arrives
```

**Key difference:**
- List pages: `store.get(refreshAtom)` - just subscribe to query
- Edit pages: `store.set(fetchAndInitFormAtom, pollId)` - fetch AND initialize form

---

## Complete Development Example: EditPollForm

The following demonstrates how to develop an "Edit Poll" feature from scratch.

### Step 1: Database Schema

Edit `backend/src/schema.ts`:

```typescript
import { pgTable, text, timestamp, uuid, integer, pgEnum, boolean, varchar } from 'drizzle-orm/pg-core'
import { users } from './auth/schema'

export const pollTypeEnum = pgEnum('poll_type', ['single', 'multiple'])
export const pollStatusEnum = pgEnum('poll_status', ['editable', 'frozen', 'paused', 'archived'])

// Export enum value types for frontend use
export type PollType = (typeof pollTypeEnum.enumValues)[number]
export type PollStatus = (typeof pollStatusEnum.enumValues)[number]

export const polls = pgTable('polls', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  type: pollTypeEnum('type').notNull().default('single'),
  status: pollStatusEnum('status').notNull().default('editable'),
  isPublic: boolean('is_public').notNull().default(false),
  deadline: timestamp('deadline', { withTimezone: true }).notNull(),
  // Audit fields (optional - enables automatic audit logging)
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export const options = pgTable('options', {
  id: uuid('id').primaryKey().defaultRandom(),
  pollId: uuid('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

// Export inferred types
export type Poll = typeof polls.$inferSelect
export type Option = typeof options.$inferSelect
export type NewPoll = typeof polls.$inferInsert
export type NewOption = typeof options.$inferInsert
```

### Step 2: Generate Migration and Write SQL

```bash
cd backend
pnpm codegen                  # Generate migration for schema changes
pnpm codegen --new-migration  # Force create new migration (for seed data, data fixes, etc.)
```

**Note:** `pnpm codegen` only generates a migration when schema changes are detected. If you need to create a data-only migration (e.g., seed data, data fixes, index changes) without schema changes, use the `--new-migration` flag.

This creates a new SQL file in `backend/drizzle/`. Edit the generated SQL file:

```sql
-- Create enum types
CREATE TYPE "poll_type" AS ENUM ('single', 'multiple');
CREATE TYPE "poll_status" AS ENUM ('editable', 'frozen', 'paused', 'archived');

-- Create polls table
CREATE TABLE "polls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" varchar(200) NOT NULL,
  "description" text,
  "type" "poll_type" NOT NULL DEFAULT 'single',
  "status" "poll_status" NOT NULL DEFAULT 'editable',
  "is_public" boolean NOT NULL DEFAULT false,
  "deadline" timestamp with time zone NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "updated_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);

-- Create options table
CREATE TABLE "options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "poll_id" uuid NOT NULL REFERENCES "polls"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id"),
  "updated_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);

-- Optional: seed data for preview
INSERT INTO "polls" ("id", "title", "description", "type", "deadline", "is_public")
VALUES ('00000000-0000-0000-0000-000000000001', 'Sample Poll', 'A sample poll for testing', 'single', NOW() + INTERVAL '7 days', true);
```

Test migration:

```bash
pnpm db:try-migrate  # Test locally with PGLite
```

### Step 3: Backend API

Create `backend/src/api/stores/EditPollFormStore.ts`:

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../../types/env'
import { loginRequired } from '../../auth'
import { polls, options } from '../../schema'

const editPollFormRoutes = new Hono<Env>()
  // GET /refresh - Fetch poll details (use query param, not path param)
  .get('/refresh', loginRequired, async (c) => {
    const id = c.req.query('id')
    if (!id) {
      throw new HTTPException(400, { message: 'id query parameter is required' })
    }

    const poll = await c.var.db.query.polls.findFirst({
      where: eq(polls.id, id),
    })

    if (!poll) {
      throw new HTTPException(404, { message: 'Poll not found' })
    }

    // Check ownership
    if (poll.createdBy !== c.var.userId) {
      throw new HTTPException(403, { message: 'Access denied' })
    }

    const pollOptions = await c.var.db.query.options.findMany({
      where: eq(options.pollId, id),
      orderBy: (options, { asc }) => [asc(options.sortOrder)],
    })

    // Convert deadline to datetime-local format for form input
    const deadlineDate = new Date(poll.deadline)
    deadlineDate.setMinutes(deadlineDate.getMinutes() - deadlineDate.getTimezoneOffset())
    const deadlineLocal = deadlineDate.toISOString().slice(0, 16)

    return c.json({
      // Poll data (read-only)
      poll: {
        id: poll.id,
        isOpen: new Date(poll.deadline) > new Date(),
        totalVotes: 0,  // Calculate from votes table in real implementation
        createdBy: poll.createdBy,
        type: poll.type,
        options: pollOptions,
      },
      // Form fields (editable)
      title: poll.title,
      description: poll.description || '',
      deadline: deadlineLocal,
      // UI state
      isSubmitting: false as boolean,
    })
  })

  // POST /update - Update poll
  .post('/update', loginRequired, zValidator('json', z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    deadline: z.string().optional(),  // Use string for datetime (JSON transmits dates as strings)
  })), async (c) => {
    const { id, title, description, deadline } = c.req.valid('json')

    // Check ownership and status
    const poll = await c.var.db.query.polls.findFirst({
      where: eq(polls.id, id),
    })

    if (!poll) {
      throw new HTTPException(404, { message: 'Poll not found' })
    }

    if (poll.createdBy !== c.var.userId) {
      throw new HTTPException(403, { message: 'Not authorized to update this poll' })
    }

    if (poll.status !== 'editable') {
      throw new HTTPException(400, { message: 'Cannot update a non-editable poll' })
    }

    // Check if poll is still open (deadline not passed)
    const isOpen = new Date(poll.deadline) > new Date()
    if (!isOpen) {
      throw new HTTPException(400, { message: 'Cannot update a closed poll' })
    }

    const [updated] = await c.var.db.update(polls)
      .set({
        title: title?.trim() ?? poll.title,
        description: description ?? poll.description,
        deadline: deadline ? new Date(deadline) : poll.deadline,
      })
      .where(eq(polls.id, id))
      .returning()

    return c.json(updated)
  })

export { editPollFormRoutes }
export type EditPollFormApi = typeof editPollFormRoutes
```

Register routes in `backend/src/app.ts`:

```typescript
import { editPollFormRoutes } from './api/stores/EditPollFormStore'

// ... other routes ...

app.route('/api/EditPollFormStore', editPollFormRoutes)
```

### Step 4: Frontend Store

Create `frontend/src/stores/EditPollFormStore.ts`:

```typescript
import { atom } from 'jotai'
import type { createStore } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { hc, type InferResponseType } from 'hono/client'
import type { EditPollFormApi } from '@backend/api/stores/EditPollFormStore'
import { apiFetch, FormError } from 'txom-frontend-libs'

type Store = ReturnType<typeof createStore>
const api = hc<EditPollFormApi>('/api/EditPollFormStore', { fetch: apiFetch })

// Form state type is inferred from server response (always specify status 200)
type FormState = InferResponseType<typeof api.refresh.$get, 200>

// Form validation errors (field-level)
type FormErrors = {
  form?: string  // General form-level error
  title?: string
  deadline?: string
}

export const formErrorsAtom = atom<FormErrors | null>(null)

// Current editing poll ID (parameter atom)
export const pollIdParamAtom = atom('')

// Server data query using atomWithQuery
export const refreshAtom = atomWithQuery((get) => {
  const pollId = get(pollIdParamAtom)
  return {
    queryKey: ['EditPollFormStore', 'poll', pollId],
    queryFn: async () => {
      const res = await api.refresh.$get({ query: { id: pollId } })
      return await res.json()
    },
    enabled: !!pollId,
  }
})

// Default form state (matches server response structure)
const defaultFormState: FormState = {
  title: '',
  description: '',
  deadline: '',
  poll: {
    id: '',
    isOpen: false,
    totalVotes: 0,
    createdBy: null,
    type: 'single' as const,
    options: [],
  },
  isSubmitting: false,
}

// Local form state for editing
export const formStateAtom = atom<FormState>(defaultFormState)

// Derived atoms for UI logic
export const canEditAtom = atom((get) => {
  const { poll } = get(formStateAtom)
  // Can edit if poll is open and has no votes
  // Note: In production, also check user is creator (backend enforces this)
  return poll.isOpen && poll.totalVotes === 0
})

// Fetch data and initialize form state (called by loader)
const fetchAndInitFormAtom = atom(null, async (get, set, pollId: string) => {
  set(pollIdParamAtom, pollId)
  set(formStateAtom, { ...defaultFormState })
  set(formErrorsAtom, null)  // Reset errors on load

  // Trigger query and wait for result
  const result = await get(refreshAtom).refetch()
  if (result.data) {
    set(formStateAtom, result.data)
  }
})

// Update form fields
export const updateFormAtom = atom(null, (get, set, updates: Partial<Pick<FormState, 'title' | 'description' | 'deadline'>>) => {
  set(formStateAtom, { ...get(formStateAtom), ...updates })

  // If form has been submitted before (errors !== null), validate in real-time
  if (get(formErrorsAtom) !== null) {
    // Validation logic here...
  }
})

// Submit update to API
export const submitAtom = atom(null, async (get, set) => {
  const state = get(formStateAtom)

  // Validate
  const errors: FormErrors = {}
  if (!state.title.trim()) errors.title = 'Title is required'
  if (!state.deadline) errors.deadline = 'Deadline is required'

  if (Object.keys(errors).length > 0) {
    set(formErrorsAtom, errors)
    throw new FormError('Please fix the errors above')
  }

  set(formStateAtom, { ...state, isSubmitting: true })
  try {
    await api.update.$post({
      json: {
        id: state.poll.id,
        title: state.title.trim(),
        description: state.description.trim() || undefined,
        deadline: state.deadline ? new Date(state.deadline).toISOString() : '',
      },
    })

    // Refetch to update UI
    const result = await get(refreshAtom).refetch()
    if (result.data) {
      set(formStateAtom, result.data)
    }
  } finally {
    set(formStateAtom, { ...get(formStateAtom), isSubmitting: false })
  }
})

// Route loader - fetch data AND initialize form (non-blocking)
export function loader(store: Store, params: { id?: string }) {
  const pollId = params.id!
  // Trigger async fetch + init form (non-blocking, UI shows skeleton)
  store.set(fetchAndInitFormAtom, pollId)
  return null
}
```

**Key patterns for Edit/Form pages:**
1. `FormState` type is inferred from server response (`InferResponseType<..., 200>`)
2. `fetchAndInitFormAtom` handles both fetching and initializing form state
3. `loader` calls `store.set(fetchAndInitFormAtom, pollId)` - NOT `store.get(refreshAtom)`
4. No separate `initFormAtom` - initialization happens inside `fetchAndInitFormAtom`

### Step 5: Page Component

Create `frontend/src/pages/EditPollForm.tsx` (note: NOT in `pages/function/` subdirectory):

```typescript
import { useAtomValue, useSetAtom } from 'jotai'
import { useNavigate } from 'react-router-dom'
import * as EditPollFormStore from '../stores/EditPollFormStore'
import { pageLinks } from '../pageLinks'

function TitleField() {
  const { title } = useAtomValue(EditPollFormStore.formStateAtom)
  const errors = useAtomValue(EditPollFormStore.formErrorsAtom)
  const updateForm = useSetAtom(EditPollFormStore.updateFormAtom)

  return (
    <div>
      <label htmlFor="title">Title</label>
      <input
        id="title"
        type="text"
        value={title}
        onChange={(e) => updateForm({ title: e.target.value })}
        required
        maxLength={200}
      />
      {errors?.title && <span className="text-red-500">{errors.title}</span>}
    </div>
  )
}

function DeadlineField() {
  const { deadline } = useAtomValue(EditPollFormStore.formStateAtom)
  const errors = useAtomValue(EditPollFormStore.formErrorsAtom)
  const updateForm = useSetAtom(EditPollFormStore.updateFormAtom)

  return (
    <div>
      <label htmlFor="deadline">Deadline</label>
      <input
        id="deadline"
        type="datetime-local"
        value={deadline}
        onChange={(e) => updateForm({ deadline: e.target.value })}
        required
      />
      {errors?.deadline && <span className="text-red-500">{errors.deadline}</span>}
    </div>
  )
}

function EditPollFormSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-3/4 mb-4" />
      <div className="h-10 bg-gray-200 rounded mb-4" />
      <div className="h-10 bg-gray-200 rounded mb-4" />
    </div>
  )
}

function CannotEditWarning() {
  const { poll } = useAtomValue(EditPollFormStore.formStateAtom)
  return (
    <div className="text-center">
      <p>This poll cannot be edited.</p>
      <a href={pageLinks.PollVotingForm(poll.id)}>Return to Poll</a>
    </div>
  )
}

function EditPollFormFields() {
  const navigate = useNavigate()
  const { poll, isSubmitting } = useAtomValue(EditPollFormStore.formStateAtom)
  const submit = useSetAtom(EditPollFormStore.submitAtom)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submit()
    navigate(pageLinks.PollVotingForm(poll.id))
  }

  return (
    <form onSubmit={handleSubmit}>
      <TitleField />
      <DeadlineField />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  )
}

// Main component - NO useEffect for form initialization!
// The loader's fetchAndInitFormAtom handles both fetching AND initializing.
function EditPollFormContent() {
  const { isPending } = useAtomValue(EditPollFormStore.refreshAtom)
  const canEdit = useAtomValue(EditPollFormStore.canEditAtom)

  if (isPending) {
    return <EditPollFormSkeleton />
  }

  if (!canEdit) {
    return <CannotEditWarning />
  }

  return <EditPollFormFields />
}

export default function EditPollFormPage() {
  return (
    <div>
      <h1>Edit Poll</h1>
      <EditPollFormContent />
    </div>
  )
}
```

**Key patterns for Edit/Form page components:**
1. **NO `useEffect` for form initialization** - the loader handles this via `fetchAndInitFormAtom`
2. Check `isPending` from `refreshAtom` for loading state
3. Form data comes from `formStateAtom`, not `refreshAtom.data`
4. Destructure fields directly: `const { title } = useAtomValue(formStateAtom)`

### Step 6: Configure Routes

Edit `frontend/src/pageLinks.ts`:

```typescript
export const pageLinks = {
  // ... existing links ...
  EditPollForm: (id: string) => `/polls/${id}/edit`,
  PollVotingForm: (id: string) => `/polls/${id}`,
}
```

Edit `frontend/src/routes.ts`:

```typescript
import EditPollForm from './pages/EditPollForm'
import * as EditPollFormStore from './stores/EditPollFormStore'

// In createBusinessRoutes:
{
  path: pageLinks.EditPollForm(':id'),
  element: createElement(EditPollForm),
  loader: async ({ params }) => {
    await EditPollFormStore.loader(store, params)
    return null
  },
},
```

### Step 7: BDD Test

From `bdd-test/tests/store/pollster/voting.test.ts` — tests multiple users voting on the same poll:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import * as PollVotingFormStore from '@frontend/stores/PollVotingFormStore'
import * as CreatePollStore from '@frontend/stores/CreatePollStore'
import * as helper from '@bdd-test/helper'
import * as authHelper from '@bdd-test/authHelper'
import { pageLinks } from '@frontend/pageLinks'

/**
 * Feature: Multiple People Voting
 *
 * As a poll creator, I want multiple people to vote so that I can gather diverse opinions.
 */
describe('Feature: Multiple People Voting', () => {
  beforeEach(async () => {
    await authHelper.signInWithRegularUserA()
  })

  it('Two people can vote on the same poll and both votes are counted', async () => {
    // Given Alice creates a poll
    await helper.navigateTo(pageLinks.CreatePoll())
    await helper.store.set(CreatePollStore.updateFormAtom, {
      title: 'Team Lunch Location',
      description: 'Where should we go?',
      type: 'single',
      deadline: helper.TEST_DEADLINES.IN_7_DAYS,
    })
    await helper.store.set(CreatePollStore.updateOptionAtom, { index: 0, value: 'Italian Restaurant' })
    await helper.store.set(CreatePollStore.updateOptionAtom, { index: 1, value: 'Japanese Restaurant' })
    await helper.store.set(CreatePollStore.addOptionAtom)
    await helper.store.set(CreatePollStore.updateOptionAtom, { index: 2, value: 'Mexican Restaurant' })
    const poll = await helper.store.set(CreatePollStore.submitAtom)
    const pollId = poll!.id
    const options = poll!.options

    // When Alice votes for Italian
    await helper.navigateTo(pageLinks.PollVotingForm(pollId))
    await helper.waitUntilLoaded(PollVotingFormStore.refreshAtom)
    await helper.store.set(PollVotingFormStore.toggleOptionAtom, { optionId: options[0].id, pollType: 'single' })
    await helper.store.set(PollVotingFormStore.submitVoteAtom)
    let pollState = helper.store.get(PollVotingFormStore.stateAtom)
    expect(pollState.poll.totalVotes).toBe(1)

    // And Bob signs in (store is reset, clean state)
    await authHelper.signInWithRegularUserB()

    // And Bob votes for Japanese
    await helper.navigateTo(pageLinks.PollVotingForm(pollId))
    await helper.waitUntilLoaded(PollVotingFormStore.refreshAtom)
    await helper.store.set(PollVotingFormStore.toggleOptionAtom, { optionId: options[1].id, pollType: 'single' })
    await helper.store.set(PollVotingFormStore.submitVoteAtom)

    // Then both votes are counted
    pollState = helper.store.get(PollVotingFormStore.stateAtom)
    expect(pollState.poll.totalVotes).toBe(2)

    // And each restaurant has one vote
    const italianVotes = pollState.poll.options.find((o) => o.id === options[0].id)!.voteCount
    const japaneseVotes = pollState.poll.options.find((o) => o.id === options[1].id)!.voteCount
    expect(italianVotes).toBe(1)
    expect(japaneseVotes).toBe(1)

    // (Discouraged) Verify DOM only when the bug is in the component rendering logic
    await helper.renderStore(pageLinks.PollVotingForm(pollId))
    expect(document.body.textContent).toContain('Your vote has been recorded')
  })
})
```

**Key test patterns:**
1. **`navigateTo` + `waitUntilLoaded`** — `navigateTo` triggers the route loader; `waitUntilLoaded` waits for async data
2. **Multi-user via `signInWithXxx`** — switching users auto-resets the Store (clean state)
3. **`renderStore` (discouraged — last resort only)** — renders the current store state into jsdom without re-executing loaders. Most bugs should be caught at the Store level; only use `renderStore` when the bug is in the component's rendering logic itself (e.g., conditional display, wrong text). Optionally pass `{ saveHtml: '/tmp/debug.html' }` to save for inspection.

Run test:

```bash
pnpm test tests/store/pollster/
```

---

## Feature Integration

### Auth Integration

The empty project doesn't include a pre-built auth module. If your feature requires user authentication, use `paraflow:auth-integration` Skill to enable.

After enabling, you'll get:
- `backend/src/auth/` - Auth module (middleware, user Schema)
- `frontend/src/auth/` - Frontend auth components (Login page, Register page, etc.)
- Auth middlewares: `loginRequired`, `adminRequired`, `publicAccessible`, `publicWithOptionalAuth`

**Public API without authentication**:

```typescript
import { Hono } from 'hono'
import type { Env } from '../../types/env'
import { publicAccessible } from '../../auth'

const publicRoutes = new Hono<Env>()
  .get('/refresh', publicAccessible, async (c) => {
    // No auth required
    return c.json({ items: [] })
  })
```

### Third-Party Service Integration

Use `paraflow:third-party-integration` Skill to integrate the following services:

| Service | Purpose |
|---------|---------|
| **R2** | File storage (images, documents, etc.) |
| **AI Gateway** | OpenAI / other AI model calls |
| **Stripe** | Payment integration |
| **OAuth** | Third-party login (Google, GitHub, etc.) |

These services are injected via the Gateway pattern and automatically replaced with Fake implementations during testing.

---

## Environment Variables

### Three Runtime Environments

| Environment | Deployment | Database | Configuration |
|-------------|------------|----------|---------------|
| **Production** | Manual publish | Real database | Paraflow Cloud console or MCP tools |
| **Dev** | Auto deploy | Real database | Paraflow Cloud console or MCP tools |
| **Agent Local** | N/A | PGLite in-memory database | `backend/.dev.vars` (backend only) |

### Backend Environment Variables

**Two types of environment variables**:

1. **System variables (PARAFLOW_* prefix)**:
   - Managed by the platform, cannot be modified by agents or users
   - Defined in `backend/src/infra/env.validation.ts`

2. **User-defined secrets (non-PARAFLOW_*)**:
   - Must be explicitly defined in `userSecretsSchema` in `backend/src/infra/env.validation.ts`
   - Values must be added to all three environments separately (see "Adding user-defined environment variables" below)

**Configuration files**:
- **`backend/src/infra/env.validation.ts`**: Zod schema for type inference only
- **`backend/src/types/env.ts`**: Cloudflare Workers Bindings type (= EnvConfig + Service Bindings)
- **`backend/.dev.vars`**: Local development only (copy from `.dev.vars.example`)

**Adding user-defined environment variables**:

1. **Add type definition**: Edit `userSecretsSchema` in `backend/src/infra/env.validation.ts`
2. **Add values to all environments**:
   - **Dev + Production environments**: Use `paraflow:ask-user` Skill (adds to both dev and production simultaneously)
   - **Local environment**: Edit `backend/.dev.vars` file (separate from dev/production)
   - Note: These are three independent environments - adding to dev/production does not affect local
3. **View existing secrets**: Use `list-secrets` MCP tool (lists dev environment user-defined variables only, excludes PARAFLOW_*)

### Frontend Environment Variables

Frontend variables must use `VITE_` prefix, injected at build time only.

**Configuration**: `frontend/.env` (system-managed, automatically configured during cloud app initialization - do NOT modify manually)

---

## Common Commands

```bash
# Root directory
pnpm dev            # Start dev server (frontend and backend)
pnpm build          # Build all packages
pnpm test           # Run BDD tests
pnpm typecheck      # Type check
pnpm lint           # ESLint check

# Backend
cd backend
pnpm codegen                  # Generate migration for schema changes
pnpm codegen --new-migration  # Force create new migration (for seed data, etc.)
pnpm db:try-migrate           # Test migrations with PGLite

# BDD Tests
cd bdd-test
pnpm test tests/store/pollster/  # Run specific test folder
```

---

## API Conventions

### Hono RPC Route Mapping

Avoid dynamic path parameters (`:id`), use query/body instead:

| Avoid | Recommended |
|-------|-------------|
| `GET /:id` | `GET /refresh?id=xxx` |
| `PUT /:id` | `POST /update` + json body `{ id, ...data }` |
| `DELETE /:id` | `POST /delete` + json body `{ id }` |

### Route to Client Call Mapping

| Backend Route | Frontend Client Call |
|---------------|---------------------|
| `GET /refresh` | `api.refresh.$get()` |
| `GET /refresh?id=xxx` | `api.refresh.$get({ query: { id } })` |
| `POST /submit` | `api.submit.$post({ json: {...} })` |
| `POST /update` | `api.update.$post({ json: { id, ...data } })` |
| `POST /delete` | `api.delete.$post({ json: { id } })` |

### Type Inference

```typescript
// IMPORTANT: Always specify status code 200 for success response type
type ServerState = InferResponseType<typeof api.refresh.$get, 200>

// Without status code, you get a union of ALL possible responses (including errors)
// type Bad = InferResponseType<typeof api.refresh.$get>  // BAD - includes error types
```

### Auth Middleware

| Middleware | Purpose | Failure Response |
|------------|---------|------------------|
| `loginRequired` | Requires login | 401 -> Redirect to login |
| `adminRequired` | Requires admin | 403 -> Access Denied |
| `publicAccessible` | Public page | Never fails |
| `publicWithOptionalAuth` | Public but user context available if logged in | Never fails |

---

## UI Patterns

### State from Store, Not Props

BDD tests directly operate on Store, components get state from Store:

```typescript
// BAD - too many props
function PollListItem({ poll, isAdmin }: { poll: Poll; isAdmin: boolean }) { ... }

// GOOD - state from Store
function PollListItem({ pollId }: { pollId: string }) {
  const poll = useAtomValue(PollListStore.pollByIdAtom(pollId))
  const isAdmin = useAtomValue(PollListStore.isAdminAtom)
  // ...
}
```

### Form Validation

Prefer HTML5 native validation:

```typescript
<input
  type="text"
  required
  minLength={1}
  maxLength={200}
/>
```

For custom validation, throw `FormError` to display Toast:

```typescript
// In Store submitAtom
const error = validateForm(get(stateAtom))
if (error) throw new FormError(error)  // -> Global toast
```

### Navigation Links

Always use `pageLinks`:

```typescript
// GOOD
<Link to={pageLinks.EditPollForm(id)}>Edit</Link>
navigate(pageLinks.PollVotingForm(id))

// BAD - hardcoded paths
<Link to={`/polls/${id}/edit`}>Edit</Link>
```

---

## BDD Testing Key Points

### Data Isolation

- Tests in the **same file** share one PGLite instance (optimization: reduces DB instances by ~83%)
- `beforeEach` automatically resets the database, Jotai store, and all fakes for each test

### Data Preparation

Prepare data through Store operations, not direct database access:

```typescript
// WRONG - no direct DB access
await db.insert(polls).values({ title: 'Test Poll' })

// CORRECT - use Store operations
await helper.navigateTo(pageLinks.CreatePoll())
await helper.store.set(CreatePollStore.updateFormAtom, { title: 'Test Poll', ... })
const poll = await helper.store.set(CreatePollStore.submitAtom)
```

### Test Helper Functions

| Function | Purpose |
|----------|---------|
| `helper.store` | Global Jotai Store |
| `helper.store.reset()` | Reset Store state |
| `helper.navigateTo(path)` | Trigger route loader |
| `helper.waitUntilLoaded(refreshAtom)` | Wait for data loading to complete |
| `helper.renderStore(url, options?)` | Render current store state to jsdom (skip loaders) |
| `helper.TEST_BASE_TIME` | Fixed test time (2025-01-15 12:00 UTC) |
| `helper.TEST_DEADLINES.IN_7_DAYS` | Future deadline for testing |

**Auth helper functions** (available only after enabling auth integration):

| Function | Purpose |
|----------|---------|
| `authHelper.signInWithRegularUserA()` | Sign in as regular user A (auto-resets Store) |
| `authHelper.signInWithRegularUserB()` | Sign in as regular user B (auto-resets Store) |
| `authHelper.signInWithAdmin()` | Sign in as admin (auto-resets Store) |
| `authHelper.signOut()` | Sign out and reset Store |

**Note:** `authHelper.signInWithXxx()` functions automatically call `helper.store.reset()` internally, so you rarely need to call `helper.store.reset()` directly.

### Writing PM-Readable Tests

Tests should be readable by PMs through test names and comments alone. Four conventions:

1. **JSDoc Feature block** at file top: `Feature: Multiple People Voting` + `As a user, I want...`
2. **User story test names**: `'I cannot delete my poll after someone has voted on it'` (not `'submitAtom should update database'`)
3. **Given/When/Then comments** between code: `// Given Alice creates a poll` → `// When Bob votes` → `// Then both votes are counted`
4. **Section headers** in long tests: `// === CREATE ===` → `// === EDIT ===` → `// === VOTE ===`
