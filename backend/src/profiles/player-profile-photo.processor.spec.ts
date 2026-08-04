import sharp from 'sharp';
import {
  PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION,
} from '../config/player-profile-photo.config';
import {
  PlayerProfilePhotoInputError,
  PlayerProfilePhotoProcessor,
} from './player-profile-photo.processor';

describe('PlayerProfilePhotoProcessor', () => {
  const processor = new PlayerProfilePhotoProcessor();

  it('normalizes a landscape JPEG into bounded square WebP variants', async () => {
    const source = await sharp({
      create: {
        width: 2_000,
        height: 1_000,
        channels: 3,
        background: { r: 30, g: 120, b: 220 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await processor.process(source, 'image/jpeg');
    const avatar = await sharp(result.avatar).metadata();
    const full = await sharp(result.full).metadata();

    expect(avatar).toMatchObject({
      format: 'webp',
      width: PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION,
      height: PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION,
    });
    expect(full).toMatchObject({
      format: 'webp',
      width: 1_000,
      height: 1_000,
    });
    expect(result.fullDimension).toBe(1_000);
    expect(result.fullSha256).toHaveLength(32);
  });

  it('rejects a declared media type that differs from the file bytes', async () => {
    const source = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: 'white',
      },
    })
      .png()
      .toBuffer();

    await expect(
      processor.process(source, 'image/jpeg'),
    ).rejects.toBeInstanceOf(PlayerProfilePhotoInputError);
  });

  it.each([
    ['invalid bytes', Buffer.from('not-an-image')],
    [
      'undersized image',
      sharp({
        create: {
          width: 255,
          height: 400,
          channels: 3,
          background: 'white',
        },
      })
        .webp()
        .toBuffer(),
    ],
  ])('rejects %s', async (_label, pendingSource) => {
    const source = await pendingSource;
    await expect(
      processor.process(source, 'image/webp'),
    ).rejects.toBeInstanceOf(PlayerProfilePhotoInputError);
  });
});
