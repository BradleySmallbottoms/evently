import { describe, expect, it } from 'vitest';

import { imageContentPosition, imageFocalPoint } from '../../../packages/domain/src/image-focal';

describe('imageFocalPoint', () => {
  it('keeps a point on the photo', () => {
    expect(imageFocalPoint({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    expect(imageFocalPoint({ x: 0.25, y: 0.4 })).toEqual({ x: 0.25, y: 0.4 });
  });

  it('refuses a point outside the photo', () => {
    expect(imageFocalPoint({ x: -0.01, y: 0.5 })).toBeNull();
    expect(imageFocalPoint({ x: 0.5, y: 1.01 })).toBeNull();
    expect(imageFocalPoint({ x: Number.NaN, y: 0.5 })).toBeNull();
    expect(imageFocalPoint({ x: '0.2', y: 0.5 })).toBeNull();
    expect(imageFocalPoint(null)).toBeNull();
  });
});

describe('imageContentPosition', () => {
  it('places the point and stays centered when the point is missing', () => {
    expect(imageContentPosition({ x: 0.25, y: 0.4 })).toEqual({ left: '25%', top: '40%' });
    expect(imageContentPosition(null)).toBe('center');
    expect(imageContentPosition({ x: 2, y: 0.4 })).toBe('center');
  });
});
