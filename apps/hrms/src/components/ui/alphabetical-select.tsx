import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { sortSelectOptions } from '@/lib/sortSelectOptions'
export const AlphabeticalSelect = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<'select'>>(({children, ...props}, ref) => <select ref={ref} {...props}>{sortSelectOptions(children)}</select>)
AlphabeticalSelect.displayName = 'AlphabeticalSelect'
