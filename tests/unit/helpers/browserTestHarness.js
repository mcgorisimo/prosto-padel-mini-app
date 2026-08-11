export function createDeterministicCrypto({
  randomByte = 0x5a,
  randomUUID = '00000000-0000-4000-8000-000000000001',
} = {}) {
  if (!Number.isInteger(randomByte) || randomByte < 0 || randomByte > 255) {
    throw new TypeError('randomByte must be an unsigned byte');
  }

  return Object.freeze({
    randomUUID: () => randomUUID,
    getRandomValues(target) {
      if (!ArrayBuffer.isView(target) || target instanceof DataView) {
        throw new TypeError('target must be a typed array');
      }
      target.fill(randomByte);
      return target;
    },
  });
}

export function createJsonFetchHarness(routes) {
  if (!(routes instanceof Map)) {
    throw new TypeError('routes must be a Map');
  }

  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push(Object.freeze({ url, init }));
    const route = routes.get(url);
    if (!route) {
      throw new Error(`Unexpected test request: ${url}`);
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...route.headers },
    });
  };

  return Object.freeze({ calls, fetchImpl });
}
