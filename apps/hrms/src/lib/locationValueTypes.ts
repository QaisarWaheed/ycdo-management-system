export const LOCATION_VALUE_TYPES = [
  { value: 'province', label: 'Province', parentLabel: null },
  { value: 'city', label: 'City', parentLabel: 'Province' },
  { value: 'district', label: 'District', parentLabel: 'Province' },
  { value: 'tehsil', label: 'Tehsil', parentLabel: 'District' },
  { value: 'police_station', label: 'Police Station', parentLabel: 'City' },
] as const

export type LocationValueType = (typeof LOCATION_VALUE_TYPES)[number]['value']
