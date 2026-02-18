
import * as fs from 'fs'
import { setupBrowserMock } from './utils/browser-mock'
import { collectAllRoutePaths } from '../../txom-frontend-libs/src/index'
import { createRoutes } from '../src/routes'
import { createStore } from 'jotai'

async function main() {
  setupBrowserMock()

  if (process.argv.length <= 2) {
    throw new Error('missing arguments')
  }

  const [outputJsonPath] = process.argv.slice(-1)

  const routePaths = collectAllRoutePaths(createRoutes(createStore()))
  if (!Array.isArray(routePaths)) {
    throw Error('routeConfigs not exists or not an array')
  }

  fs.writeFileSync(outputJsonPath, JSON.stringify({
    pathnames: routePaths
  }))
}
main()
