import { atom } from "jotai";

const authHandler$ = atom<{
  f: (isAuth: boolean) => void
} | null>(null)

export const setAuthStateChangedHandler$ = atom(
  null,
  (get, set, callback: (isAuth: boolean) => void) => {
    set(authHandler$, { f: callback })
  }
)

export const getAuthStateChangedHandler$ = atom(
  (get) => get(authHandler$)?.f ?? null
)