// Type declarations for modules used by pi-mono source
declare module 'turndown' {
  class TurndownService {
    constructor(options?: any)
    turndown(html: string): string
    addRule(key: string, rule: any): this
    remove(filter: string | string[] | ((node: any, options: any) => boolean)): this
    use(plugin: any): this
  }
  export default TurndownService
}

declare module 'sprintf-js' {
  export function sprintf(format: string, ...args: any[]): string
  export function vsprintf(format: string, args: any[]): string
}

declare module 'papaparse' {
  export function parse<T = any>(input: string, config?: any): any
  export function unparse(data: any, config?: any): string
  const Papa: { parse: typeof parse; unparse: typeof unparse }
  export default Papa
}

declare module 'undici' {
  export class ProxyAgent {
    constructor(options: any)
  }
  export class EnvHttpProxyAgent {
    constructor(options?: any)
  }
  export function setGlobalDispatcher(dispatcher: any): void
  export function fetch(input: any, init?: any): Promise<any>
}

declare module 'ini' {
  export function parse(str: string): any
  export function stringify(obj: any, options?: any): string
  export function encode(obj: any, options?: any): string
  export function decode(str: string): any
}
