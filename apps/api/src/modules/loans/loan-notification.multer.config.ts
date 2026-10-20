import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];

/** Signed loan approval notification (JPG / PNG / PDF, 10 MB). Never public. */
export const loanNotificationMulterConfig = {
  storage: diskStorage({
    destination: (req, _file, cb) => {
      const loanId = req.params.id as string;
      // The id becomes a folder name: only a UUID is accepted.
      if (!/^[0-9a-f-]{36}$/i.test(loanId)) {
        cb(new BadRequestException('Invalid loan id'), '');
        return;
      }
      const dir = path.join(process.cwd(), 'uploads', 'loan-notifications', loanId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `notification-${Date.now()}${ext}`);
    },
  }),
  fileFilter: (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Only JPG, PNG, or PDF files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};
