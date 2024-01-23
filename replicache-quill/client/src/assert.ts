type Truthy<T> = T extends null | undefined | false | '' | 0 ? never : T;

export function assert<T>(
  b: T,
  msg = 'Assertion failed',
): asserts b is Truthy<T> {
  if (!b) {
    throw new Error(msg);
  }
}
