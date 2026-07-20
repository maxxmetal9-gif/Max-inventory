export const formatQty = (value, unit = 'kg') => {
  const number = Number(value) || 0;
  return `${number.toFixed(2)} ${unit}`;
};
