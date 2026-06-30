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
  pakistanCities,
  pakistanDistricts,
  pakistanProvinces,
  punjabTehsils,
} from '@/lib/pakistanData'
import { saveLocationValue } from '@/lib/saveLocationValue'

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
}: {
  control: Control<FieldValues>
  setValue: UseFormSetValue<FieldValues>
  province: string
  district: string
  permanentProvince: string
}) {
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
      <SearchableSelect
        label="Domicile *"
        options={pakistanProvinces}
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
        options={pakistanProvinces}
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
        allowNew
        onNewValue={(v) => saveLocationValue('city', v, province)}
        placeholder={province ? 'Select city' : 'Select province first'}
        error={cityField.fieldState.error?.message}
      />

      <SearchableSelect
        label="District *"
        options={districtOptions}
        value={districtField.field.value ?? ''}
        onChange={(v) => {
          districtField.field.onChange(v)
          setValue('tehsil', '')
        }}
        disabled={!province}
        allowNew
        onNewValue={(v) => saveLocationValue('district', v, province)}
        placeholder={province ? 'Select district' : 'Select province first'}
        error={districtField.fieldState.error?.message}
      />

      <SearchableSelect
        label="Tehsil *"
        options={tehsilOptions}
        value={tehsilField.field.value ?? ''}
        onChange={tehsilField.field.onChange}
        disabled={!district}
        allowNew
        onNewValue={(v) => saveLocationValue('tehsil', v, province, undefined)}
        placeholder={district ? 'Select tehsil' : 'Select district first'}
        error={tehsilField.fieldState.error?.message}
      />

      <SearchableSelect
        label="Police Station *"
        options={policeOptions}
        value={policeStationField.field.value ?? ''}
        onChange={policeStationField.field.onChange}
        allowNew
        onNewValue={(v) => saveLocationValue('police_station', v)}
        placeholder="Select or add police station"
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
        label="Province *"
        options={pakistanProvinces}
        value={permanentProvinceField.field.value ?? ''}
        onChange={(v) => {
          permanentProvinceField.field.onChange(v)
          setValue('permanentCity', '')
        }}
        placeholder="Select province"
        error={permanentProvinceField.fieldState.error?.message}
      />

      <SearchableSelect
        label="City *"
        options={permanentCityOptions}
        value={permanentCityField.field.value ?? ''}
        onChange={permanentCityField.field.onChange}
        disabled={!permanentProvince}
        allowNew
        onNewValue={(v) => saveLocationValue('city', v, permanentProvince)}
        placeholder={
          permanentProvince ? 'Select city' : 'Select province first'
        }
        error={permanentCityField.fieldState.error?.message}
      />

      <FieldWrapper
        label="Street Address *"
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
