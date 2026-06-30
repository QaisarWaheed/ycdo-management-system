import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Control, FieldValues, UseFormSetValue } from 'react-hook-form'
import { locationValuesApi } from '@/api/endpoints/locationValues'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import {
  pakistanCities,
  pakistanDistricts,
  pakistanProvinces,
  punjabTehsils,
} from '@/lib/pakistanData'
import { saveLocationValue } from '@/lib/saveLocationValue'

export function EmployeeLocationFields({
  control,
  setValue,
  province,
  district,
  permanentProvince,
}: {
  control: Control<FieldValues>
  setValue: UseFormSetValue<FieldValues>
  province: string
  district: string
  permanentProvince: string
}) {
  const { data: dbTehsils = [] } = useQuery({
    queryKey: ['location-values', 'tehsil', district],
    queryFn: () => locationValuesApi.getAll('tehsil', district),
    enabled: !!district,
  })

  const { data: dbPoliceStations = [] } = useQuery({
    queryKey: ['location-values', 'police_station'],
    queryFn: () => locationValuesApi.getAll('police_station'),
  })

  const tehsilOptions = useMemo(() => {
    const staticTehsils = district ? (punjabTehsils[district] ?? []) : []
    const fromDb = dbTehsils.map((t) => t.value)
    return [...new Set([...staticTehsils, ...fromDb])].sort()
  }, [district, dbTehsils])

  const policeOptions = useMemo(
    () => dbPoliceStations.map((p) => p.value).sort(),
    [dbPoliceStations],
  )

  const cityOptions = province ? (pakistanCities[province] ?? []) : []
  const districtOptions = province ? (pakistanDistricts[province] ?? []) : []
  const permanentCityOptions = permanentProvince
    ? (pakistanCities[permanentProvince] ?? [])
    : []

  return (
    <>
      <FormField
        control={control}
        name="domicile"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Domicile *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={pakistanProvinces}
                value={field.value}
                onChange={field.onChange}
                placeholder="Select province"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <h3 className="text-sm font-semibold text-text-secondary sm:col-span-2">
        Current Address
      </h3>
      <FormField
        control={control}
        name="province"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Province *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={pakistanProvinces}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v)
                  setValue('city', '')
                  setValue('district', '')
                  setValue('tehsil', '')
                }}
                placeholder="Select province"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="city"
        render={({ field }) => (
          <FormItem>
            <FormLabel>City *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={cityOptions}
                value={field.value}
                onChange={field.onChange}
                disabled={!province}
                allowNew
                onNewValue={(v) => saveLocationValue('city', v, province)}
                placeholder={province ? 'Select city' : 'Select province first'}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="district"
        render={({ field }) => (
          <FormItem>
            <FormLabel>District *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={districtOptions}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v)
                  setValue('tehsil', '')
                }}
                disabled={!province}
                allowNew
                onNewValue={(v) => saveLocationValue('district', v, province)}
                placeholder={province ? 'Select district' : 'Select province first'}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="tehsil"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tehsil *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={tehsilOptions}
                value={field.value}
                onChange={field.onChange}
                disabled={!district}
                allowNew
                onNewValue={(v) =>
                  saveLocationValue('tehsil', v, province, undefined)
                }
                placeholder={district ? 'Select tehsil' : 'Select district first'}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="policeStation"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Police Station *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={policeOptions}
                value={field.value}
                onChange={field.onChange}
                allowNew
                onNewValue={(v) => saveLocationValue('police_station', v)}
                placeholder="Select or add police station"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="currentAddress"
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Street Address *</FormLabel>
            <FormControl>
              <Textarea {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <h3 className="text-sm font-semibold text-text-secondary sm:col-span-2">
        Permanent Address
      </h3>
      <FormField
        control={control}
        name="permanentProvince"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Province *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={pakistanProvinces}
                value={field.value}
                onChange={(v) => {
                  field.onChange(v)
                  setValue('permanentCity', '')
                }}
                placeholder="Select province"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="permanentCity"
        render={({ field }) => (
          <FormItem>
            <FormLabel>City *</FormLabel>
            <FormControl>
              <SearchableSelect
                options={permanentCityOptions}
                value={field.value}
                onChange={field.onChange}
                disabled={!permanentProvince}
                allowNew
                onNewValue={(v) =>
                  saveLocationValue('city', v, permanentProvince)
                }
                placeholder={
                  permanentProvince ? 'Select city' : 'Select province first'
                }
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="permanentAddress"
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Street Address *</FormLabel>
            <FormControl>
              <Textarea {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}
