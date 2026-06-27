import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AdminUsersService } from './admin-users.service';

/**
 * Re-renders the team page with an inline error instead of the generic error
 * page when a user mutation fails — both ValidationPipe failures (thrown before
 * the controller runs, e.g. a short password) and the BadRequestExceptions the
 * service throws (duplicate email, last-admin guard, self-delete). Applied via
 * @UseFilters on AdminUsersController.
 */
@Injectable()
@Catch(BadRequestException)
export class AdminUsersFormFilter implements ExceptionFilter {
  constructor(private readonly users: AdminUsersService) {}

  async catch(exception: BadRequestException, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { user?: AuthUser }>();
    const res = ctx.getResponse<Response>();

    res.status(400).render('admin/users/list', {
      title: 'Users',
      users: await this.users.list(),
      me: req.user,
      error: this.readMessage(exception),
      // Repopulate the "add user" fields (minus the password) so the admin can
      // fix the flagged field without retyping everything.
      form: (req.body ?? {}) as Record<string, unknown>,
    });
  }

  private readMessage(ex: BadRequestException): string {
    const r = ex.getResponse();
    if (typeof r === 'string') return r;
    const m = (r as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join('. ');
    if (typeof m === 'string') return m;
    return ex.message;
  }
}
