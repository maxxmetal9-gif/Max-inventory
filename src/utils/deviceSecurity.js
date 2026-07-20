import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { supabase } from '../supabase';

export const clearStoredUserData = () => {
  console.log('Clearing user data from localStorage');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('employee');
  localStorage.removeItem('user');
};

// This function generates a unique "Digital Fingerprint" for the device
export const getDeviceFingerprint = async () => {
  console.log('Generating device fingerprint...');
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  const visitorId = result.visitorId;
  console.log('Device fingerprint generated:', visitorId);
  return visitorId;
};

// This is deliberately verified against the server on every app load.
export const isDeviceApprovedForUser = async (userId) => {
  console.log(`Checking device approval for user: ${userId}`);
  
  let currentDeviceId;
  try {
    currentDeviceId = await getDeviceFingerprint();
  } catch (fpError) {
    console.error('Fingerprint generation failed:', fpError);
    return { approved: false, reason: 'FINGERPRINT_ERROR', profile: null, currentDeviceId: null };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('allowed_device_id')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = 'single row not found'
    console.error('Error fetching user profile:', error);
    return { approved: false, reason: 'DB_ERROR', details: error.message, profile: null, currentDeviceId };
  }
  
  console.log('User profile fetched:', profile);

  if (!profile) {
    console.warn('User profile not found.');
    return { approved: false, reason: 'PROFILE_NOT_FOUND', profile: null, currentDeviceId };
  }

  if (profile.allowed_device_id === null || profile.allowed_device_id === undefined) {
    console.log('`allowed_device_id` is null or undefined, treating as an empty array.');
    profile.allowed_device_id = [];
  }

  if (!Array.isArray(profile.allowed_device_id)) {
    console.error('`allowed_device_id` is not an array:', profile.allowed_device_id);
    return { approved: false, reason: 'INVALID_DEVICE_ID_FORMAT', profile, currentDeviceId };
  }

  const allowedDeviceIds = (profile.allowed_device_id || []).filter(Boolean); // filter out null, undefined, ""
  console.log('Allowed device IDs from profile:', allowedDeviceIds);

  const isApproved = allowedDeviceIds.includes(currentDeviceId);
  console.log(`Device approval result: ${isApproved ? 'APPROVED' : 'DENIED'}`);

  if (isApproved) {
    return { approved: true, reason: 'DEVICE_APPROVED', profile, currentDeviceId, allowedDeviceIds };
  } else {
    return { approved: false, reason: 'DEVICE_DENIED', profile, currentDeviceId, allowedDeviceIds };
  }
};
