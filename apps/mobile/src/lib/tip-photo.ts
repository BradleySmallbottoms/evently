import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { canLaunchCamera, type TipImageSource } from '@/lib/camera';
import { tipImageContentType } from '@/lib/tips';

const options: ImagePicker.ImagePickerOptions = {
  base64: true,
  quality: 0.5,
  mediaTypes: ['images'],
};

export async function chooseTipImage(source: TipImageSource): Promise<
  | { ok: false; reason: 'denied' | 'canceled' }
  | {
      ok: true;
      uri: string;
      contentType: ReturnType<typeof tipImageContentType>;
      dataBase64: string;
    }
> {
  if (source === 'camera' && canLaunchCamera(Platform.OS, Device.isDevice)) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'denied' };
    return readShot(await ImagePicker.launchCameraAsync(options));
  }
  // The system photo picker does not need photo-library permission.
  return readShot(await ImagePicker.launchImageLibraryAsync(options));
}

function readShot(shot: ImagePicker.ImagePickerResult): Awaited<ReturnType<typeof chooseTipImage>> {
  if (shot.canceled || !shot.assets[0]?.base64) return { ok: false, reason: 'canceled' };
  return {
    ok: true,
    uri: shot.assets[0].uri,
    contentType: tipImageContentType(shot.assets[0].mimeType),
    dataBase64: shot.assets[0].base64,
  };
}
