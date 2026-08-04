import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION,
  PLAYER_PROFILE_PHOTO_MAX_FULL_DIMENSION,
  PLAYER_PROFILE_PHOTO_MAX_INPUT_PIXELS,
} from '../config/player-profile-photo.config';

const ACCEPTED_FORMATS = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const);

export type AcceptedPlayerProfilePhotoMediaType =
  (typeof ACCEPTED_FORMATS)[keyof typeof ACCEPTED_FORMATS];

export type ProcessedPlayerProfilePhoto = Readonly<{
  avatar: Buffer;
  full: Buffer;
  fullDimension: number;
  fullSha256: Buffer;
}>;

export class PlayerProfilePhotoInputError extends Error {
  readonly name = 'PlayerProfilePhotoInputError';

  constructor() {
    super('Player profile photo input is invalid');
  }
}

export class PlayerProfilePhotoProcessor {
  async process(
    input: Buffer,
    declaredMediaType: AcceptedPlayerProfilePhotoMediaType,
  ): Promise<ProcessedPlayerProfilePhoto> {
    try {
      const metadata = await sharp(input, {
        animated: false,
        failOn: 'warning',
        limitInputPixels: PLAYER_PROFILE_PHOTO_MAX_INPUT_PIXELS,
        sequentialRead: true,
      }).metadata();
      const detectedMediaType =
        metadata.format === undefined
          ? undefined
          : ACCEPTED_FORMATS[
              metadata.format as keyof typeof ACCEPTED_FORMATS
            ];
      if (
        detectedMediaType === undefined ||
        detectedMediaType !== declaredMediaType ||
        metadata.width === undefined ||
        metadata.height === undefined ||
        metadata.width < PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION ||
        metadata.height < PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION ||
        (metadata.pages ?? 1) !== 1
      ) {
        throw new PlayerProfilePhotoInputError();
      }

      const fullDimension = Math.min(
        PLAYER_PROFILE_PHOTO_MAX_FULL_DIMENSION,
        metadata.width,
        metadata.height,
      );
      const common = {
        fit: sharp.fit.cover,
        position: sharp.strategy.attention,
      } as const;
      const [avatar, full] = await Promise.all([
        sharp(input, {
          animated: false,
          failOn: 'warning',
          limitInputPixels: PLAYER_PROFILE_PHOTO_MAX_INPUT_PIXELS,
          sequentialRead: true,
        })
          .autoOrient()
          .resize({
            width: PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION,
            height: PLAYER_PROFILE_PHOTO_AVATAR_DIMENSION,
            ...common,
          })
          .webp({ quality: 84, effort: 5, smartSubsample: true })
          .toBuffer(),
        sharp(input, {
          animated: false,
          failOn: 'warning',
          limitInputPixels: PLAYER_PROFILE_PHOTO_MAX_INPUT_PIXELS,
          sequentialRead: true,
        })
          .autoOrient()
          .resize({
            width: fullDimension,
            height: fullDimension,
            ...common,
          })
          .webp({ quality: 88, effort: 5, smartSubsample: true })
          .toBuffer(),
      ]);

      return Object.freeze({
        avatar,
        full,
        fullDimension,
        fullSha256: createHash('sha256').update(full).digest(),
      });
    } catch (error) {
      if (error instanceof PlayerProfilePhotoInputError) {
        throw error;
      }
      throw new PlayerProfilePhotoInputError();
    }
  }
}
