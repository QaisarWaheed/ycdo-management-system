import { Children, Fragment, cloneElement, isValidElement, type ReactNode } from 'react'

export const compareOptionLabels = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
const label = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return isValidElement<{children?: ReactNode; label?: string; textValue?: string}>(node)
    ? node.props.textValue ?? node.props.label ?? Children.toArray(node.props.children).map(label).join(' ') : ''
}
/** Keep groups intact and All/None/placeholders first; sort each option level. */
export function sortSelectOptions(children: ReactNode): ReactNode[] {
  const nodes = Children.toArray(children).flatMap(node => isValidElement<{children?: ReactNode}>(node) && node.type === Fragment ? Children.toArray(node.props.children) : [node])
  const mapped = nodes.map(node => {
    if (!isValidElement<{children?: ReactNode; value?: unknown; label?: string}>(node)) return node
    if (node.props.value === undefined && node.props.children && typeof node.props.children !== 'string')
      return cloneElement(node, {children: sortSelectOptions(node.props.children)})
    return node
  })
  const rank = (node: ReactNode) => {
    if (!isValidElement<{value?: unknown; disabled?: boolean; label?: string}>(node)) return 0
    const value = String(node.props.value ?? '')
    return node.props.disabled || /^(all|none|__all__|)$/i.test(value) && !node.props.label ? 0 : 1
  }
  // Months and weekdays keep their calendar order (January → December, Sunday → Saturday).
  const labels = mapped.filter((n) => rank(n) === 1).map((n) => label(n).trim().toLowerCase())
  if (labels.length && labels.every((l) => CALENDAR_LABELS.has(l)))
    return mapped.sort((a, b) => rank(a) - rank(b))
  return mapped.sort((a,b) => rank(a)-rank(b) || compareOptionLabels(label(a), label(b)))
}

const CALENDAR_LABELS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
])
