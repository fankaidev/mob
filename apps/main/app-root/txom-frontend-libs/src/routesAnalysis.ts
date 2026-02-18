import { createStore } from 'jotai'
import { RouteObject } from 'react-router-dom'

function collectPathsRecursively(routes: RouteObject[], parentPath: string = ''): string[] {
    return routes.flatMap((route) => {
        const fullPath = [parentPath, route.path].filter(Boolean).join('/').replaceAll(/\/+/g, '/')
        const currentPaths = route.path ? [fullPath] : []
        const childPaths = route.children ? collectPathsRecursively(route.children, fullPath) : []
        return [...currentPaths, ...childPaths]
    })
}

export function collectAllRoutePaths(routes: RouteObject[]) {
    return collectPathsRecursively(routes)
}
