type TableRecordCountProps = {
  count: number
  total?: number
  label?: string
  extra?: React.ReactNode
}

function pluralize(count: number, label: string) {
  if (count === 1) return label
  if (label.endsWith('y')) return `${label.slice(0, -1)}ies`
  return `${label}s`
}

export function TableRecordCount({
  count,
  total,
  label = 'record',
  extra,
}: TableRecordCountProps) {
  const noun = pluralize(count, label)

  return (
    <div className="space-y-1">
      <p className="text-sm text-text-secondary">
        {total !== undefined && total !== count
          ? `Showing ${count} of ${total} ${noun}`
          : `Showing ${count} ${noun}`}
      </p>
      {extra}
    </div>
  )
}
