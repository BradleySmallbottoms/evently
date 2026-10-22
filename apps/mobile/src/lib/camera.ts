/**
 * The iOS Simulator grants camera permission, then `UIImagePickerController`
 * aborts when the camera source is set. A real iPhone or Android can open the
 * camera. A browser uses the photo library.
 */
export function canLaunchCamera(os: string, isDevice: boolean): boolean {
  return (os === 'ios' && isDevice) || os === 'android';
}

export type TipImageSource = 'camera' | 'library';

/** Camera when this device can open it. The photo library is always available. */
export function tipImageSources(os: string, isDevice: boolean): TipImageSource[] {
  return canLaunchCamera(os, isDevice) ? ['camera', 'library'] : ['library'];
}
