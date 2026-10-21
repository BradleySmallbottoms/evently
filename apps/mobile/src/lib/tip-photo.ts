import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { canLaunchCamera } from '@/lib/camera';
import { tipImageContentType } from '@/lib/tips';

export async function chooseTipImage(): Promise<
  | { ok: false; reason: 'denied' | 'canceled' }
  | {
      ok: true;
      uri: string;
      contentType: ReturnType<typeof tipImageContentType>;
      dataBase64: string;
    }
> {
  const permission = canLaunchCamera(Platform.OS, Device.isDevice)
    ? await ImagePicker.requestCameraPermissionsAsync()
    : { granted: false };
  const library = permission.granted
    ? permission
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!library.granted && !permission.granted) return { ok: false, reason: 'denied' };
  const shot = permission.granted
    ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
    : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
  if (shot.canceled || !shot.assets[0]?.base64) return { ok: false, reason: 'canceled' };
  return {
    ok: true,
    uri: shot.assets[0].uri,
    contentType: tipImageContentType(shot.assets[0].mimeType),
    dataBase64: shot.assets[0].base64,
  };
}
