import FingerprintJS from '@fingerprintjs/fingerprintjs';

// This function generates a unique "Digital Fingerprint" for the phone
export const getDeviceFingerprint = async () => {
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  return result.visitorId; 
};