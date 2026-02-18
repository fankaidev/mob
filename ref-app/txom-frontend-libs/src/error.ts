

export class NativeModalBlockedError extends Error {
  constructor(
    public readonly modalType: 'alert' | 'confirm' | 'prompt',
    public readonly attemptedMessage?: string
  ) {
    super(`window.${modalType} is disabled. Use toast instead.`)
    this.name = 'NativeModalBlockedError'
  }
}
