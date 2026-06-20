import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ContentStatus } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Controller()
export class PagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('pages/:slug')
  async page(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    await this.render(res, slug, 'page');
  }

  @Get('blog/:slug')
  async post(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    await this.render(res, slug, 'blog');
  }

  private async render(res: Response, slug: string, type: string): Promise<void> {
    const page = await this.prisma.pageContent.findFirst({
      where: { slug, type, status: ContentStatus.PUBLISHED },
    });
    if (!page) throw new NotFoundException('Page not found');
    res.render('pages/content', {
      title: page.seoTitle || page.title,
      metaDescription: page.seoDescription || page.excerpt,
      canonical: `${process.env.APP_URL ?? ''}/${type === 'blog' ? 'blog' : 'pages'}/${page.slug}`,
      page,
    });
  }
}
