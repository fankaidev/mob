// Global navigation state atoms
export const globalNavigation: {
    navigate: ((path: string) => void) | null
    globalRouteChangeCallback: ((pathname: string) => void) | null
} = {
    navigate: null,
    globalRouteChangeCallback: null
}