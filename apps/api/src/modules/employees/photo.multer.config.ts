import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

export const photoMulterConfig = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const employeeId = req.params.id as string;
      const dir = path.join(process.cwd(), 'uploads', 'photos', employeeId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `photo${ext}`);
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
      cb(new BadRequestException('Only JPG and PNG files allowed'), false);
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
};
