/**
 * The iOS Simulator grants camera permission, then `UIImagePickerController`
 * aborts when the camera source is set. A real device can open the camera.
 */
export function canLaunchCamera(os: string, isDevice: boolean): boolean {
  return os !== 'ios' || isDevice;
}
