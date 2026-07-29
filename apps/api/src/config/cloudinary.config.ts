import { v2 as cloudinary } from 'cloudinary';

export const initCloudinary = () => {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
};

export { cloudinary };

export function isCloudinaryEnabled(): boolean {
  return !!process.env.CLOUDINARY_CLOUD_NAME;
}

/** Upload a PDF buffer to Cloudinary as raw; returns secure_url. */
export async function uploadPdfToCloudinary(
  buffer: Buffer,
  publicId: string,
  folder = 'letters',
): Promise<string> {
  if (!isCloudinaryEnabled()) {
    throw new Error('Cloudinary is not configured');
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'raw',
        overwrite: true,
        format: 'pdf',
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error ?? new Error('Cloudinary upload failed'));
          return;
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}
