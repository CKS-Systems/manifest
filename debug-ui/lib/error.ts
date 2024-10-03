export const ensureError = (value: unknown): Error => {
  if (value instanceof Error) return value;

  let stringified = '[Unable to stringify the thrown value]';
  try {
    stringified = JSON.stringify(value);
    // eslint-disable-next-line no-empty
  } catch {}

  const error = new Error(
    `This value was thrown as is, not through an Error: ${stringified}`,
  );
  return error;
};
