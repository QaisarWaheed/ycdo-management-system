import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-text-secondary">This module is coming soon.</p>
      </CardContent>
    </Card>
  )
}
