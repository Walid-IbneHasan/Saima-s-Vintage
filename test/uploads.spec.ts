import * as fs from 'fs';
import * as path from 'path';
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

  it('writes a valid PNG and returns its public URL', async () => {
    const file = {
      buffer: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
      ]),
      size: 12,
      mimetype: 'image/png',
      originalname: 'test.png',
    } as any;

    const { url } = await svc.saveProductImage(file);
    expect(url).toMatch(/^\/uploads\/products\/.+\.png$/);

    fs.unlinkSync(
      path.join(
        process.cwd(),
        'public',
        'uploads',
        'products',
        url.split('/').pop() as string,
      ),
    );
  });
});
