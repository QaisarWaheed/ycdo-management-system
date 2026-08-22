/** Half-hour increments, 12:00 AM through 11:30 PM. */
export const dutyTimeOptions = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return {
    label: `${String(h12).padStart(2, '0')}:${m} ${suffix}`,
    value: `${String(h24).padStart(2, '0')}:${m}`,
  }
})

export function formatDutyDisplay(
  start?: string | null,
  end?: string | null,
): string {
  if (!start || !end) return 'Not assigned'
  const startLabel =
    dutyTimeOptions.find((o) => o.value === start)?.label ?? start
  const endLabel = dutyTimeOptions.find((o) => o.value === end)?.label ?? end
  return `${startLabel} - ${endLabel}`
}
