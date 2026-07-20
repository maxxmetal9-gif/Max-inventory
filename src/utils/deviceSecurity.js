import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { supabase } from '../supabase';

export const clearStoredUserData = () => {
  localStorage.removeItem('userEmail');
  localStorage.removeItem('employee');
  localStorage.removeItem('user');
};

// This function generates a unique "Digital Fingerprint" for the phone
export const getDeviceFingerprint = async () => {
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  return result.visitorId;
};

// This is deliberately verified against the server on every app load. Do not
// replace it with a localStorage flag: a browser flag can be stale or altered.
export const isDeviceApprovedForUser = async (userId) => {
  const [currentDeviceId, { data: profile, error }] = await Promise.all([
    getDeviceFingerprint(),
    supabase
      .from('profiles')
      .select('allowed_device_id')
      .eq('id', userId)
      .single(),
  ]);

  if (error) throw error;

  const allowedDeviceIds = (profile.allowed_device_id || [])
    .filter((id) => id !== null && id !== 'null');

  return allowedDeviceIds.includes(currentDeviceId);
};
