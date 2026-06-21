export function toBigIntSafe(value: string | number | bigint): bigint {
  try {
    return BigInt(value);
  } catch (err) {
    throw new Error(`Invalid BigInt value: ${value}`);
  }
}

export function fromStroops(stroops: bigint | string | number): string {
  const stroopsStr = stroops.toString().padStart(8, '0');
  const integerPart = stroopsStr.slice(0, -7) || '0';
  const fractionalPart = stroopsStr.slice(-7).replace(/0+$/, '');
  return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
}

export function toStroops(amount: string | number): bigint {
  const str = amount.toString();
  if (!/^\d+(\.\d{1,7})?$/.test(str)) {
    throw new Error('Invalid amount format or too many decimal places');
  }
  const [intPart, fracPart = ''] = str.split('.');
  const stroopsStr = `${intPart}${fracPart.padEnd(7, '0')}`;
  return BigInt(stroopsStr);
}

export function isValidTimestamp(timestamp: string | number | bigint): boolean {
  try {
    const ts = BigInt(timestamp);
    // Basic bounds checking for reasonable timestamps
    return ts > 0n && ts < 4102444800n; // Year 2100
  } catch {
    return false;
  }
}
