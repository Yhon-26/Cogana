type CryptoWithRandomUuid = Crypto & {
  randomUUID?: () => string;
};

export function createId() {
  const cryptoObject = globalThis.crypto as CryptoWithRandomUuid | undefined;
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }

  let seed = Date.now();
  let highResolutionSeed = typeof performance !== 'undefined' ? performance.now() * 1000 : 0;

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    let random = Math.random() * 16;
    if (seed > 0) {
      random = (seed + random) % 16;
      seed = Math.floor(seed / 16);
    } else {
      random = (highResolutionSeed + random) % 16;
      highResolutionSeed = Math.floor(highResolutionSeed / 16);
    }

    const value = character === 'x' ? random : (random % 4) + 8;
    return Math.floor(value).toString(16);
  });
}
