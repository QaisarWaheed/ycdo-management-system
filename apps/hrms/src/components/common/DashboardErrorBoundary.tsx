import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <p className="text-text-secondary">
            Something went wrong loading the dashboard.
          </p>
          <Button
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Reload page
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
