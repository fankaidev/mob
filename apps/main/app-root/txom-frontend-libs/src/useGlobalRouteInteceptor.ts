import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { globalNavigation } from "./globalNavigation"


export function useTxomRouteInteceptor() {
    const navigate = useNavigate()
    const location = useLocation()

    // Set up global navigation
    useEffect(() => {
        globalNavigation.navigate = navigate
    }, [navigate])

    // Handle route changes
    useEffect(() => {
        if (globalNavigation.globalRouteChangeCallback) {
            globalNavigation.globalRouteChangeCallback(location.pathname)
        }
    }, [location.pathname]
    )
}