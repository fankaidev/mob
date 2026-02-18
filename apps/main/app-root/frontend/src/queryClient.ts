/**
 * QueryClient configuration for jotai-tanstack-query
 */
import { QueryClient } from '@tanstack/query-core'
import { atom } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'

export const resetQueryClient = atom(null, (get, set) => {
  const prev = get(queryClientAtom)
  prev.clear()

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        refetchOnWindowFocus: false,
        retry: false,
        throwOnError: true,
      },
    },
  })
  set(queryClientAtom, queryClient)
})