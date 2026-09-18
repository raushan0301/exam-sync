'use client';

import type { ReactElement } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import type { FieldValues, Path } from 'react-hook-form';
import { FieldWrapper, describedByIds } from './FieldWrapper';

export interface FormFieldProps<TFieldValues extends FieldValues> {
  name: Path<TFieldValues>;
  label?: string;
  description?: string;
  required?: boolean;
  /** Render prop: receives the field's current value/onChange/onBlur plus computed a11y attrs. */
  children: (field: {
    value: unknown;
    onChange: (value: unknown) => void;
    onBlur: () => void;
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactElement;
}

/**
 * Generic wrapper connecting react-hook-form's Controller to FieldWrapper's
 * label/description/error chrome. Not hardcoded to one form — pass any
 * `name` from the surrounding FormProvider's schema and a render prop for
 * the actual input control (Input/Select/Textarea/Checkbox/etc.).
 */
export function FormField<TFieldValues extends FieldValues>({
  name,
  label,
  description,
  required,
  children,
}: FormFieldProps<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>();
  const fieldId = `field-${name}`;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <FieldWrapper
          id={fieldId}
          label={label}
          description={description}
          error={fieldState.error?.message}
          required={required}
        >
          {children({
            value: field.value,
            onChange: field.onChange,
            onBlur: field.onBlur,
            id: fieldId,
            'aria-invalid': !!fieldState.error || undefined,
            'aria-describedby': describedByIds(fieldId, description, fieldState.error?.message),
          })}
        </FieldWrapper>
      )}
    />
  );
}
