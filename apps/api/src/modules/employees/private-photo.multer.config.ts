import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import * as path from 'path';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

export const privatePhotoMulterConfig = {
  storage: memoryStorage(),
  fileFilter: (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (
      ALLOWED_MIME_TYPES.includes(file.mimetype) &&
      ALLOWED_EXTENSIONS.includes(extension)
    ) {
      cb(null, true);
      return;
    }

    cb(
      new BadRequestException('Only JPG and PNG images are allowed'),
      false,
    );
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
};
