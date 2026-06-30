import { locationValuesApi } from '@/api/endpoints/locationValues'

export async function saveLocationValue(
  type: string,
  value: string,
  province?: string,
  city?: string,
) {
  try {
    await locationValuesApi.create({ type, value, province, city })
  } catch (e) {
    console.error('Failed to save location value', e)
  }
}
