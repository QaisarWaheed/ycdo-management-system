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
  return mapped.sort((a,b) => rank(a)-rank(b) || compareOptionLabels(label(a), label(b)))
}
