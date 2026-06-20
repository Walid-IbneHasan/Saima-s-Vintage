import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';

interface Signature {
  ext: string;
  mime: string;
  test: (b: Buffer) => boolean;
}

// Validate by magic bytes, NOT the client-supplied mimetype (which is spoofable).
const SIGNATURES: Signature[] = [
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47,
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    ext: 'avif',
    mime: 'image/avif',
    test: (b) =>
      b.length > 12 &&
      b.toString('ascii', 4, 8) === 'ftyp' &&
      ['avif', 'avis', 'mif1', 'msf1'].includes(b.toString('ascii', 8, 12)),
  },
];

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_ALLOWED_MIME = SIGNATURES.map((s) => s.mime);

@Injectable()
export class UploadsService {
  private readonly baseDir = join(process.cwd(), 'public', 'uploads');

  constructor() {
    for (const sub of ['products', 'avatars']) {
      const dir = join(this.baseDir, sub);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  saveProductImage(file: Express.Multer.File): Promise<{ url: string }> {
    return this.save(file, 'products');
  }

  saveAvatar(file: Express.Multer.File): Promise<{ url: string }> {
    return this.save(file, 'avatars');
  }

  /** Validates magic bytes, writes with a randomized name, returns the public URL. */
  private async save(
    file: Express.Multer.File,
    subdir: string,
  ): Promise<{ url: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      throw new BadRequestException('File too large (max 5 MB)');
    }
    const sig = SIGNATURES.find((s) => s.test(file.buffer));
    if (!sig) {
      throw new BadRequestException(
        'Unsupported image type (allowed: JPEG, PNG, WebP, AVIF)',
      );
    }
    const name = `${randomUUID()}.${sig.ext}`;
    await writeFile(join(this.baseDir, subdir, name), file.buffer);
    return { url: `/uploads/${subdir}/${name}` };
  }
}
