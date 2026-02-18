export async function takeAllStateSnapshot() {
  return {
    stateTreeRoot: {
      sharedLocationState: {
        pathname$: window.location.pathname,
      },
    }
  }
}

export async function injectAllState(rawInjected: unknown) {
  const injected = rawInjected as {
    prototypeMems?: Record<string, unknown>
    stateTreeRoot: {
      sharedLocationState: {
        pathname$: string
      }
    }
  } | undefined

  if (injected) {
    window.history.pushState('', '', injected.stateTreeRoot.sharedLocationState.pathname$)
  }
}