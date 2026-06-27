import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ContentStatus } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Controller()
export class PagesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bespoke, on-brand About page. Declared before the `pages/:slug` catch-all so
   * it always wins over any DB-backed page that happens to use the same slug.
   */
  @Get('pages/about')
  about(@Res() res: Response): void {
    const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
    res.render('pages/about', {
      title: "Our Story — Saima's Vintage",
      metaDescription:
        "The story behind Saima's Vintage — how a love of Kutchi Lippan mirror art and Mughal Jharoka windows became a small atelier devoted to restoring heritage, one piece at a time.",
      canonical: `${base}/pages/about`,
      ogImage: `${base}/images/atelier-heritage-collection.webp`,
    });
  }

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
