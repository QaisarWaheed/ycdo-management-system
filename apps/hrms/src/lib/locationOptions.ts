import {
  pakistanCities,
  pakistanDistricts,
  pakistanProvinces,
  punjabTehsils,
} from '@/lib/pakistanData'
import type { LocationValue } from '@/api/endpoints/locationValues'

export function mergeLocationOptions(
  staticList: string[],
  dbValues: LocationValue[],
): string[] {
  const fromDb = dbValues.map((item) => item.value)
  return [...new Set([...staticList, ...fromDb])].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function mergeProvinceOptions(dbProvinces: LocationValue[]) {
  return mergeLocationOptions(pakistanProvinces, dbProvinces)
}

export function mergeCityOptions(
  province: string,
  dbCities: LocationValue[],
) {
  const staticCities = province ? (pakistanCities[province] ?? []) : []
  return mergeLocationOptions(staticCities, dbCities)
}

export function mergeDistrictOptions(
  province: string,
  dbDistricts: LocationValue[],
) {
  const staticDistricts = province ? (pakistanDistricts[province] ?? []) : []
  return mergeLocationOptions(staticDistricts, dbDistricts)
}

export function mergeTehsilOptions(
  district: string,
  dbTehsils: LocationValue[],
) {
  const staticTehsils = district ? (punjabTehsils[district] ?? []) : []
  return mergeLocationOptions(staticTehsils, dbTehsils)
}

export function mergePoliceStationOptions(dbValues: LocationValue[]) {
  return dbValues.map((item) => item.value).sort((a, b) => a.localeCompare(b))
}
