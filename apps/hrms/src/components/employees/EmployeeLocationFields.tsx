import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useController,
  type Control,
  type FieldValues,
  type UseFormSetValue,
} from 'react-hook-form'
import { locationValuesApi } from '@/api/endpoints/locationValues'
import { SearchableSelect } from '@/components/common/SearchableSelect'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  mergeCityOptions,
  mergeDistrictOptions,
  mergePoliceStationOptions,
  mergeProvinceOptions,
  mergeTehsilOptions,
} from '@/lib/locationOptions'

function FieldWrapper({
  label,
  error,
  className,
  children,
}: {
  label: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
        {label}
      </label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export function EmployeeLocationFields({
  control,
  setValue,
  province,
  district,
  permanentProvince,
  relaxedOptionalFields = false,
}: {
  control: Control<FieldValues>
  setValue: UseFormSetValue<FieldValues>
  province: string
  district: string
  permanentProvince: string
  relaxedOptionalFields?: boolean
}) {
  const opt = (label: string, required = true) =>
    relaxedOptionalFields && !required ? label : `${label} *`
  const domicile = useController({ control, name: 'domicile' })
  const provinceField = useController({ control, name: 'province' })
  const cityField = useController({ control, name: 'city' })
  const districtField = useController({ control, name: 'district' })
  const tehsilField = useController({ control, name: 'tehsil' })
  const policeStationField = useController({ control, name: 'policeStation' })
  const currentAddressField = useController({ control, name: 'currentAddress' })
  const permanentProvinceField = useController({
    control,
    name: 'permanentProvince',
  })
  const permanentCityField = useController({ control, name: 'permanentCity' })
  const permanentAddressField = useController({
    control,
    name: 'permanentAddress',
  })

  const { data: dbProvinces = [] } = useQuery({
    queryKey: ['location-values', 'province'],
    queryFn: () => locationValuesApi.getAll('province'),
  })

  const { data: dbCities = [] } = useQuery({
    queryKey: ['location-values', 'city', province],
    queryFn: () => locationValuesApi.getAll('city'),
    enabled: !!province,
  })

  const { data: dbDistricts = [] } = useQuery({
    queryKey: ['location-values', 'district', province],
    queryFn: () => locationValuesApi.getAll('district'),
    enabled: !!province,
  })

  const { data: dbTehsils = [] } = useQuery({
    queryKey: ['location-values', 'tehsil', district],
    queryFn: () => locationValuesApi.getAll('tehsil', district),
    enabled: !!district,
  })

  const { data: dbPoliceStations = [] } = useQuery({
    queryKey: ['location-values', 'police_station'],
    queryFn: () => locationValuesApi.getAll('police_station'),
  })

  const provinceOptions = useMemo(
    () => mergeProvinceOptions(dbProvinces),
    [dbProvinces],
  )

  const tehsilOptions = useMemo(
    () => mergeTehsilOptions(district, dbTehsils),
    [district, dbTehsils],
  )

  const policeOptions = useMemo(
    () => mergePoliceStationOptions(dbPoliceStations),
    [dbPoliceStations],
  )

  const cityOptions = useMemo(
    () => mergeCityOptions(province, dbCities),
    [province, dbCities],
  )

  const districtOptions = useMemo(
    () => mergeDistrictOptions(province, dbDistricts),
    [province, dbDistricts],
  )

  const permanentCityOptions = useMemo(
    () => mergeCityOptions(permanentProvince, dbCities),
    [permanentProvince, dbCities],
  )

  return (
    <>
      <SearchableSelect
        label={opt('Domicile', false)}
        options={provinceOptions}
        value={domicile.field.value ?? ''}
        onChange={domicile.field.onChange}
        placeholder="Select province"
        error={domicile.fieldState.error?.message}
      />

      <h3 className="text-sm font-semibold text-text-secondary sm:col-span-2">
        Current Address
      </h3>

      <SearchableSelect
        label="Province *"
        options={provinceOptions}
        value={provinceField.field.value ?? ''}
        onChange={(v) => {
          provinceField.field.onChange(v)
          setValue('city', '')
          setValue('district', '')
          setValue('tehsil', '')
        }}
        placeholder="Select province"
        error={provinceField.fieldState.error?.message}
      />

      <SearchableSelect
        label="City *"
        options={cityOptions}
        value={cityField.field.value ?? ''}
        onChange={cityField.field.onChange}
        disabled={!province}
        placeholder={province ? 'Select city' : 'Select province first'}
        error={cityField.fieldState.error?.message}
      />

      <SearchableSelect
        label={opt('District', false)}
        options={districtOptions}
        value={districtField.field.value ?? ''}
        onChange={(v) => {
          districtField.field.onChange(v)
          setValue('tehsil', '')
        }}
        disabled={!province}
        placeholder={province ? 'Select district' : 'Select province first'}
        error={districtField.fieldState.error?.message}
      />

      <SearchableSelect
        label={opt('Tehsil', false)}
        options={tehsilOptions}
        value={tehsilField.field.value ?? ''}
        onChange={tehsilField.field.onChange}
        disabled={!district}
        placeholder={district ? 'Select tehsil' : 'Select district first'}
        error={tehsilField.fieldState.error?.message}
      />

      <SearchableSelect
        label={opt('Police Station', false)}
        options={policeOptions}
        value={policeStationField.field.value ?? ''}
        onChange={policeStationField.field.onChange}
        placeholder="Select police station"
        error={policeStationField.fieldState.error?.message}
      />

      <FieldWrapper
        label="Street Address *"
        error={currentAddressField.fieldState.error?.message}
        className="sm:col-span-2"
      >
        <Textarea
          value={currentAddressField.field.value ?? ''}
          onChange={currentAddressField.field.onChange}
          onBlur={currentAddressField.field.onBlur}
          name={currentAddressField.field.name}
          ref={currentAddressField.field.ref}
        />
      </FieldWrapper>

      <h3 className="text-sm font-semibold text-text-secondary sm:col-span-2">
        Permanent Address
      </h3>

      <SearchableSelect
        label={opt('Province', false)}
        options={provinceOptions}
        value={permanentProvinceField.field.value ?? ''}
        onChange={(v) => {
          permanentProvinceField.field.onChange(v)
          setValue('permanentCity', '')
        }}
        placeholder="Select province"
        error={permanentProvinceField.fieldState.error?.message}
      />

      <SearchableSelect
        label={opt('City', false)}
        options={permanentCityOptions}
        value={permanentCityField.field.value ?? ''}
        onChange={permanentCityField.field.onChange}
        disabled={!permanentProvince}
        placeholder={
          permanentProvince ? 'Select city' : 'Select province first'
        }
        error={permanentCityField.fieldState.error?.message}
      />

      <FieldWrapper
        label={opt('Street Address', false)}
        error={permanentAddressField.fieldState.error?.message}
        className="sm:col-span-2"
      >
        <Textarea
          value={permanentAddressField.field.value ?? ''}
          onChange={permanentAddressField.field.onChange}
          onBlur={permanentAddressField.field.onBlur}
          name={permanentAddressField.field.name}
          ref={permanentAddressField.field.ref}
        />
      </FieldWrapper>
    </>
  )
}
