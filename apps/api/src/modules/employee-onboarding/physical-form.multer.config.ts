import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];

export const physicalFormMulterConfig = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const employeeId = req.params.employeeId as string;
      const dir = path.join(
        process.cwd(),
        'uploads',
        'onboarding-forms',
        employeeId,
      );
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `physical-form-${timestamp}${ext}`);
    },
  }),
  fileFilter: (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      ALLOWED_MIME_TYPES.includes(file.mimetype) &&
      ALLOWED_EXTENSIONS.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException('Only JPG, PNG, or PDF files are allowed'),
        false,
      );
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
};
