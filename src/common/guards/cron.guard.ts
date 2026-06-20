import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/** Guards the /internal/cron/* endpoints with a shared secret header. */
@Injectable()
export class CronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = String(req.headers['x-cron-token'] ?? '');
    const expected = process.env.CRON_TOKEN ?? '';
    if (!expected || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
