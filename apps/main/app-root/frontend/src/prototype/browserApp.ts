import { createApp } from '@backend/app'
import { createBrowserGateways } from './browserGateways'

export async function createBrowserApp() {
    return createApp(createBrowserGateways())
}
