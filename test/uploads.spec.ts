import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { UploadsService } from '../src/modules/admin/uploads.service';

describe('UploadsService', () => {
  const svc = new UploadsService();

  it('rejects a non-image buffer', async () => {
    const file = {
      buffer: Buffer.from('not an image'),
      size: Buffer.byteLength('not an image'),
      mimetype: 'text/plain',
      originalname: 'not-image.txt',
    } as any;

    await expect(svc.saveProductImage(file)).rejects.toThrow();
  });

  it('rejects an empty buffer', async () => {
    const file = {
      buffer: Buffer.alloc(0),
      size: 0,
      mimetype: 'image/png',
      originalname: 'empty.png',
    } as any;

    await expect(svc.saveProductImage(file)).rejects.toThrow();
  });

  it('rejects a buffer with a valid signature but undecodable content', async () => {
    // Passes the PNG magic-byte check but isn't a real image — sharp must reject it.
    const file = {
      buffer: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
      ]),
      size: 12,
      mimetype: 'image/png',
      originalname: 'corrupt.png',
    } as any;

    await expect(svc.saveProductImage(file)).rejects.toThrow();
  });

  it('converts a valid image to a resized WebP and returns its public URL', async () => {
    const buffer = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const file = {
      buffer,
      size: buffer.length,
      mimetype: 'image/png',
      originalname: 'test.png',
    } as any;

    const { url } = await svc.saveProductImage(file);
    expect(url).toMatch(/^\/uploads\/products\/.+\.webp$/);

    const saved = path.join(
      process.cwd(),
      'public',
      'uploads',
      'products',
      url.split('/').pop() as string,
    );
    // Read into a buffer first so no file handle lingers (Windows unlink lock).
    const meta = await sharp(fs.readFileSync(saved)).metadata();
    expect(meta.format).toBe('webp');
    try {
      fs.unlinkSync(saved);
    } catch {
      /* best-effort cleanup of the test artifact */
    }
  });
});
