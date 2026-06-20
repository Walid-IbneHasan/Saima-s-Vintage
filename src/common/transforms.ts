import { Transform } from 'class-transformer';

/** HTML checkbox → boolean ('on' when checked, absent otherwise). */
export const ToBool = () =>
  Transform(({ value }) =>
    value === true || value === 'on' || value === 'true' || value === '1',
  );

/** Form field that may be single or repeated → always an array. */
export const ToArray = () =>
  Transform(({ value }) =>
    value === undefined || value === null
      ? []
      : Array.isArray(value)
        ? value
        : [value],
  );

/** Empty string / missing → undefined; otherwise Number. */
export const ToNumber = () =>
  Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : Number(value),
  );

/** Trim a string, mapping empty to undefined. */
export const ToTrimmed = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t === '' ? undefined : t;
  });
